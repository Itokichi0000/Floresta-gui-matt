#!/usr/bin/env python3
"""floresta-ui server: serves the static UI and relays JSON-RPC to florestad.

The browser only ever talks to this server (same origin). This server reads
florestad's .cookie (or a configured user/password), adds the Basic auth
header and forwards allow-listed RPC methods. Credentials never reach the
browser, logs or error messages.

Run with:  python3 server/serve.py
Only the Python standard library is used.
"""

from __future__ import annotations

import base64
import http.client
import ipaddress
import json
import mimetypes
import socket
import webbrowser
import sys
import threading
import time
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import NETWORKS, VERSION, Config, ConfigError, load_config  # noqa: E402

# ----- RPC policy (design doc 4.1) -----------------------------------------

READ_METHODS = frozenset({
    "getblockchaininfo", "getbestblockhash", "getblockcount", "getblockhash",
    "getblockheader", "getblock", "getpeerinfo", "getconnectioncount",
    "getnetworkinfo", "getmemoryinfo", "getroots", "uptime", "listdescriptors",
    "getrpcinfo", "getaddrmaninfo", "getdeploymentinfo",
})
WRITE_METHODS = frozenset({"addnode", "disconnectnode", "loaddescriptor", "rescanblockchain"})
DANGEROUS_METHODS = frozenset({"stop", "sendrawtransaction"})

DEFAULT_TIMEOUT = 10.0
SLOW_METHOD_TIMEOUTS = {"getblock": 30.0, "rescanblockchain": 30.0}
MAX_BODY_BYTES = 64 * 1024

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
}

# The UI loads nothing from other origins, so the policy can be strict.
CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; "
    "form-action 'self'; frame-ancestors 'none'"
)

SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
}


def split_host_port(value: str) -> tuple[str, str | None]:
    """Split a Host header value into (hostname, port)."""
    value = value.strip()
    if value.startswith("["):
        end = value.find("]")
        if end == -1:
            return value, None
        host, rest = value[1:end], value[end + 1 :]
        return host, rest[1:] if rest.startswith(":") else None
    if value.count(":") == 1:
        host, port = value.split(":")
        return host, port
    return value, None


def is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


class RelayError(Exception):
    """An error to report to the browser. Messages never contain secrets."""

    def __init__(self, status: int, code: str, message: str | None = None):
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message


class Credentials:
    """Basic auth credentials for florestad.

    Uses FLORESTA_RPC_USER/PASSWORD when set, otherwise the cookie file.
    The cookie rotates on every florestad restart, so it is re-read when the
    file changes and whenever florestad answers 401.
    """

    def __init__(self, config: Config):
        self.config = config
        self._lock = threading.Lock()
        self._cached: str | None = None
        self._mtime: float | None = None
        self._path = None

    @property
    def mode(self) -> str:
        return "password" if self.config.uses_password else "cookie"

    def header(self, force_reload: bool = False) -> str | None:
        """Return the Authorization header value, or None if no credential is available."""
        value = self._value(force_reload)
        if value is None:
            return None
        return "Basic " + base64.b64encode(value.encode("utf-8")).decode("ascii")

    def _value(self, force_reload: bool) -> str | None:
        if self.config.uses_password:
            return f"{self.config.rpc_user or ''}:{self.config.rpc_password}"
        path = self.config.cookie_path
        with self._lock:
            try:
                mtime = path.stat().st_mtime
            except OSError:
                # florestad removes the cookie on shutdown.
                self._cached, self._mtime = None, None
                return None
            if force_reload or self._cached is None or mtime != self._mtime or path != self._path:
                self._path = path
                try:
                    text = path.read_text(encoding="utf-8").strip()
                except (OSError, UnicodeDecodeError):
                    self._cached, self._mtime = None, None
                    return None
                self._cached = text if ":" in text else None
                self._mtime = mtime
            return self._cached


class FlorestadClient:
    """Forwards one JSON-RPC call to florestad."""

    def __init__(self, config: Config):
        self.config = config
        self.credentials = Credentials(config)
        # Never send node traffic through an HTTP(S)_PROXY from the environment.
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self._next_id = 0
        self._id_lock = threading.Lock()
        self._detect_lock = threading.Lock()
        self._last_detect = float("-inf")

    # ----- network auto-detection ------------------------------------------

    DETECT_INTERVAL = 5.0

    def _candidates(self) -> list[str]:
        """Networks to try: those with a cookie on disk first (newest first), then the rest."""
        with_cookie = []
        for name in NETWORKS:
            try:
                with_cookie.append((self.config.cookie_path_for(name).stat().st_mtime, name))
            except OSError:
                pass
        ordered = [name for _, name in sorted(with_cookie, reverse=True)]
        return ordered + [name for name in NETWORKS if name not in ordered]

    def detect_network(self, force: bool = False) -> bool:
        """Point the client at whichever network's florestad is listening.

        Only used when FLORESTA_NETWORK and FLORESTAD_URL were not set.
        Returns True if the target changed.
        """
        if not self.config.auto_network:
            return False
        with self._detect_lock:
            now = time.monotonic()
            if not force and now - self._last_detect < self.DETECT_INTERVAL:
                return False
            self._last_detect = now
            for name in self._candidates():
                port = NETWORKS[name].rpc_port
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.3):
                        pass
                except OSError:
                    continue
                url = f"http://127.0.0.1:{port}"
                changed = (name, url) != (self.config.network, self.config.florestad_url)
                self.config.network, self.config.florestad_url = name, url
                return changed
            return False

    def _request_id(self) -> int:
        with self._id_lock:
            self._next_id += 1
            return self._next_id

    def _post(self, body: bytes, auth: str | None, timeout: float) -> tuple[int, bytes]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if auth:
            headers["Authorization"] = auth
        req = urllib.request.Request(self.config.florestad_url, data=body, headers=headers, method="POST")
        try:
            with self._opener.open(req, timeout=timeout) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as exc:
            with exc:
                return exc.code, exc.read()

    def call(self, method: str, params: list | dict) -> dict:
        """Return {"result": ..., "error": ...} or raise RelayError."""
        try:
            return self._call(method, params)
        except RelayError as exc:
            # florestad may have been started on another network: look again.
            if exc.code in ("node_unreachable", "auth_failed") and self.detect_network():
                return self._call(method, params)
            raise

    def _call(self, method: str, params: list | dict) -> dict:
        timeout = SLOW_METHOD_TIMEOUTS.get(method, DEFAULT_TIMEOUT)
        body = json.dumps(
            {"jsonrpc": "2.0", "id": self._request_id(), "method": method, "params": params}
        ).encode("utf-8")
        try:
            auth = self.credentials.header()
            status, raw = self._post(body, auth, timeout)
            if status == 401 and self.credentials.mode == "cookie":
                # The cookie may have rotated (florestad restarted): read it again.
                fresh = self.credentials.header(force_reload=True)
                if fresh and fresh != auth:
                    status, raw = self._post(body, fresh, timeout)
        except (TimeoutError, socket.timeout):
            raise RelayError(HTTPStatus.GATEWAY_TIMEOUT, "timeout", f"florestad did not answer {method} in {timeout:.0f}s") from None
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, (TimeoutError, socket.timeout)):
                raise RelayError(HTTPStatus.GATEWAY_TIMEOUT, "timeout", f"florestad did not answer {method} in {timeout:.0f}s") from None
            raise RelayError(HTTPStatus.BAD_GATEWAY, "node_unreachable") from None
        except (OSError, ValueError, http.client.HTTPException):
            raise RelayError(HTTPStatus.BAD_GATEWAY, "node_unreachable") from None

        if status == 401:
            if self.credentials.mode == "cookie":
                hint = (
                    f"florestad rejected the request. No usable cookie at {self.config.cookie_path}: "
                    "check FLORESTA_DATADIR and FLORESTA_NETWORK."
                    if self.credentials.header() is None
                    else "florestad rejected the cookie. Check FLORESTA_DATADIR and FLORESTA_NETWORK."
                )
            else:
                hint = "florestad rejected FLORESTA_RPC_USER / FLORESTA_RPC_PASSWORD."
            raise RelayError(HTTPStatus.BAD_GATEWAY, "auth_failed", hint)
        if status == 503:
            raise RelayError(HTTPStatus.SERVICE_UNAVAILABLE, "node_busy", "florestad is busy, try again.")
        try:
            doc = json.loads(raw) if raw else None
        except ValueError:
            doc = None
        if not isinstance(doc, dict) or ("result" not in doc and "error" not in doc):
            raise RelayError(HTTPStatus.BAD_GATEWAY, "bad_response", f"unexpected answer from florestad (HTTP {status})")
        return {"result": doc.get("result"), "error": doc.get("error")}


class UIServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, config: Config):
        self.config = config
        self.static_root = config.static_dir.resolve()
        self.client = FlorestadClient(config)
        super().__init__((config.bind_host, config.bind_port), Handler)

    @property
    def port(self) -> int:
        return self.server_address[1]

    def handle_error(self, request, client_address) -> None:
        # A browser closing a tab mid-response is not worth a traceback.
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)

    def host_allowed(self, host_header: str | None) -> bool:
        """DNS rebinding guard: only accept names that cannot be rebound.

        IP literals and localhost are always fine (an attacker's page cannot
        make the browser send them), plus any names listed in
        UI_ALLOWED_HOSTS / --allowed-host.
        """
        if not host_header:
            return False
        host, _port = split_host_port(host_header)
        host = host.lower().rstrip(".")
        if not host:
            return False
        if host == "localhost" or host.endswith(".localhost") or is_ip_literal(host):
            return True
        if host == self.config.bind_host.lower():
            return True
        return host in self.config.allowed_hosts

    def method_allowed(self, method: str) -> bool:
        if method in READ_METHODS or method in WRITE_METHODS:
            return True
        return self.config.allow_dangerous and method in DANGEROUS_METHODS


class Handler(BaseHTTPRequestHandler):
    server: UIServer
    server_version = f"floresta-ui/{VERSION}"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    # ----- plumbing -------------------------------------------------------

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        if not self.server.config.quiet:
            sys.stderr.write(f"{self.address_string()} - {format % args}\n")

    def send_bytes(self, status: int, body: bytes, content_type: str, extra: dict | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        for key, value in SECURITY_HEADERS.items():
            self.send_header(key, value)
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status: int, payload: object, extra: dict | None = None) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_bytes(status, body, "application/json; charset=utf-8", extra)

    def reject(self, status: int, code: str, message: str | None = None) -> None:
        payload = {"error": code}
        if message:
            payload["message"] = message
        self.send_json(status, payload)

    def check_host(self) -> bool:
        if self.server.host_allowed(self.headers.get("Host")):
            return True
        self.reject(
            HTTPStatus.FORBIDDEN,
            "host_not_allowed",
            "Unknown Host header. Add the name with --allowed-host or UI_ALLOWED_HOSTS.",
        )
        return False

    # ----- HTTP verbs -----------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        if not self.check_host():
            return
        path = urlsplit(self.path).path
        if path == "/api/info":
            self.send_json(HTTPStatus.OK, self.info())
            return
        if path.startswith("/api/"):
            self.reject(HTTPStatus.NOT_FOUND, "not_found")
            return
        self.serve_static(path)

    do_HEAD = do_GET

    def do_POST(self) -> None:  # noqa: N802
        if not self.check_host():
            return
        if urlsplit(self.path).path != "/api/rpc":
            self.reject(HTTPStatus.NOT_FOUND, "not_found")
            return
        self.handle_rpc()

    def _method_not_allowed(self) -> None:
        self.reject(HTTPStatus.METHOD_NOT_ALLOWED, "http_method_not_allowed")

    do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _method_not_allowed

    # ----- endpoints ------------------------------------------------------

    def info(self) -> dict:
        cfg = self.server.config
        return {
            "name": "floresta-ui",
            "version": VERSION,
            "network": cfg.network,
            "allow_dangerous": cfg.allow_dangerous,
            "methods": {
                "read": sorted(READ_METHODS),
                "write": sorted(WRITE_METHODS),
                "dangerous": sorted(DANGEROUS_METHODS) if cfg.allow_dangerous else [],
            },
        }

    def from_browser(self) -> bool:
        """Browsers always send at least one of these on a cross-site POST."""
        return any(self.headers.get(h) for h in ("Origin", "Sec-Fetch-Site", "Sec-Fetch-Mode", "Referer"))

    def check_origin(self) -> bool:
        origin = self.headers.get("Origin")
        if origin is None:
            return True
        parts = urlsplit(origin)
        host = (self.headers.get("Host") or "").lower()
        if origin == "null" or parts.scheme not in ("http", "https") or parts.netloc.lower() != host:
            self.reject(HTTPStatus.FORBIDDEN, "origin_not_allowed")
            return False
        return True

    def handle_rpc(self) -> None:
        if not self.check_origin():
            return
        content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        # CSRF guard: a page on another site can only send "simple" content
        # types without a preflight, so browsers must say application/json.
        # Command-line tools (curl) send none of the browser headers.
        if content_type != "application/json" and self.from_browser():
            self.reject(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_media_type", "Use Content-Type: application/json.")
            return
        try:
            length = int(self.headers.get("Content-Length") or "")
        except ValueError:
            self.close_connection = True
            self.send_json(HTTPStatus.LENGTH_REQUIRED, {"error": "length_required"}, {"Connection": "close"})
            return
        if length < 0 or length > MAX_BODY_BYTES:
            # The body is left unread, so this connection cannot be reused.
            self.close_connection = True
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "body_too_large"}, {"Connection": "close"})
            return
        raw = self.rfile.read(length)
        try:
            req = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            self.reject(HTTPStatus.BAD_REQUEST, "bad_request", "Body must be JSON.")
            return
        if not isinstance(req, dict) or not isinstance(req.get("method"), str):
            self.reject(HTTPStatus.BAD_REQUEST, "bad_request", 'Expected {"method": "...", "params": [...]}.')
            return
        method = req["method"]
        params = req.get("params", [])
        if params is None:
            params = []
        if not isinstance(params, (list, dict)):
            self.reject(HTTPStatus.BAD_REQUEST, "bad_request", "params must be an array.")
            return
        if not self.server.method_allowed(method):
            self.reject(HTTPStatus.FORBIDDEN, "method_not_allowed")
            return
        try:
            payload = self.server.client.call(method, params)
        except RelayError as exc:
            self.reject(exc.status, exc.code, exc.message)
            return
        self.send_json(HTTPStatus.OK, payload)

    def serve_static(self, url_path: str) -> None:
        rel = unquote(url_path).lstrip("/") or "index.html"
        parts = [p for p in rel.split("/") if p not in ("", ".")]
        # No parent traversal and no dotfiles.
        if any(p == ".." or p.startswith(".") for p in parts) or "\\" in rel or "\0" in rel:
            self.reject(HTTPStatus.NOT_FOUND, "not_found")
            return
        target = (self.server.static_root / Path(*parts)) if parts else self.server.static_root
        try:
            target = target.resolve()
            target.relative_to(self.server.static_root)
        except (ValueError, OSError):
            self.reject(HTTPStatus.NOT_FOUND, "not_found")
            return
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            self.reject(HTTPStatus.NOT_FOUND, "not_found")
            return
        content_type = CONTENT_TYPES.get(target.suffix.lower()) or (
            mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        )
        self.send_bytes(HTTPStatus.OK, target.read_bytes(), content_type)


def ui_url(config: Config, port: int) -> str:
    host = config.bind_host
    if host in ("0.0.0.0", "::", ""):
        host = "127.0.0.1"
    if ":" in host:
        host = f"[{host}]"
    return f"http://{host}:{port}/"


def node_status(server: "UIServer") -> str:
    """One line about florestad, for the startup banner. Never contains secrets."""
    try:
        info = server.client.call("getblockchaininfo", [])
    except RelayError as exc:
        if exc.code == "node_unreachable":
            if server.config.auto_network:
                ports = ", ".join(str(n.rpc_port) for n in NETWORKS.values())
                return f"no florestad found yet (looked on ports {ports}). Start it; the UI keeps looking."
            return "not reachable yet. Start florestad; the UI keeps retrying. If it runs on another network, set FLORESTA_NETWORK."
        return f"{exc.code}: {exc.message or ''}".strip()
    result = info.get("result") or {}
    if info.get("error") or not isinstance(result, dict):
        return "answered with an error to getblockchaininfo"
    blocks = result.get("blocks", result.get("validated", result.get("height")))
    headers = result.get("headers", result.get("height"))
    return f"connected ({result.get('chain', server.config.network)}, height {blocks:,} of {headers:,})" if isinstance(blocks, int) and isinstance(headers, int) else "connected"


def print_banner(config: Config, port: int, status: str | None = None) -> None:
    out = sys.stderr
    out.write(f"floresta-ui {VERSION}\n")
    out.write(f"  UI:        {ui_url(config, port)}\n")
    if config.auto_network and status and status.startswith("no florestad"):
        out.write("  florestad: any network (set FLORESTA_NETWORK to pick one)\n")
    else:
        detected = ", detected automatically" if config.auto_network else ""
        out.write(f"  florestad: {config.florestad_url} (network: {config.network}{detected})\n")
    if status:
        out.write(f"  status:    {status}\n")
    if config.uses_password:
        out.write("  auth:      FLORESTA_RPC_USER / FLORESTA_RPC_PASSWORD\n")
    elif config.auto_network and status and status.startswith("no florestad"):
        out.write(f"  auth:      cookie under {config.datadir}\n")
    else:
        out.write(f"  auth:      cookie at {config.cookie_path}\n")
    if config.allow_dangerous:
        out.write("  WARNING:   --allow-dangerous: stop and sendrawtransaction are relayed.\n")
    if not config.is_loopback:
        out.write(
            "  WARNING:   listening on a non-loopback address. Anyone who can reach this\n"
            "             machine can use the UI (there is no login yet). Only do this on a\n"
            "             network you trust.\n"
        )


def main(argv: list[str] | None = None) -> int:
    try:
        config = load_config(argv)
    except ConfigError as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2
    try:
        server = UIServer(config)
    except OSError as exc:
        sys.stderr.write(f"error: cannot listen on {config.bind_display}: {exc.strerror or exc}\n")
        return 1
    server.client.detect_network(force=True)
    print_banner(config, server.port, node_status(server))
    if config.open_browser:
        threading.Timer(0.5, webbrowser.open, args=(ui_url(config, server.port),)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
