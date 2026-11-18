#!/usr/bin/env python3
"""floresta-ui server: serves the static UI.

Run with:  python3 server/serve.py
Only the Python standard library is used.
"""

from __future__ import annotations

import ipaddress
import json
import mimetypes
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import VERSION, Config, ConfigError, load_config  # noqa: E402

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


class UIServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, config: Config):
        self.config = config
        self.static_root = config.static_dir.resolve()
        super().__init__((config.bind_host, config.bind_port), Handler)

    @property
    def port(self) -> int:
        return self.server_address[1]

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
        self.reject(HTTPStatus.NOT_FOUND, "not_found")

    def _method_not_allowed(self) -> None:
        self.reject(HTTPStatus.METHOD_NOT_ALLOWED, "http_method_not_allowed")

    do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _method_not_allowed

    # ----- endpoints ------------------------------------------------------

    def info(self) -> dict:
        cfg = self.server.config
        return {"name": "floresta-ui", "version": VERSION, "network": cfg.network}

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


def print_banner(config: Config, port: int) -> None:
    out = sys.stderr
    out.write(f"floresta-ui {VERSION}\n")
    out.write(f"  UI:        http://{config.bind_display.rsplit(':', 1)[0]}:{port}/\n")
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
    print_banner(config, server.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
