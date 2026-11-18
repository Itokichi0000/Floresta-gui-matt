"""Configuration for floresta-ui.

Settings come from environment variables and command-line flags. Flags win
over environment variables. Only the Python standard library is used.

| Variable                | Flag               | Default                          |
|-------------------------|--------------------|----------------------------------|
| FLORESTAD_URL           | --florestad-url    | http://127.0.0.1:<network port>  |
| FLORESTA_DATADIR        | --datadir          | ~/.floresta                      |
| FLORESTA_NETWORK        | --network          | auto-detected, else bitcoin      |
| FLORESTA_RPC_USER       | --rpc-user         | (none)                           |
| FLORESTA_RPC_PASSWORD   | (env only)         | (none)                           |
| FLORESTA_RPC_COOKIE_FILE| --cookie-file      | <datadir>/[<net>/].cookie        |
| UI_BIND                 | --bind             | 127.0.0.1:3000                   |
| UI_ALLOWED_HOSTS        | --allowed-host     | (none)                           |
| UI_ALLOW_DANGEROUS      | --allow-dangerous  | off                              |
"""

from __future__ import annotations

import argparse
import ipaddress
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping, Sequence

VERSION = "0.1.0"

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_STATIC_DIR = ROOT_DIR / "static"


@dataclass(frozen=True)
class Network:
    name: str
    subdir: str  # where florestad keeps the cookie, relative to the datadir
    rpc_port: int


# Matches florestad's layout: mainnet sits at the datadir root, every other
# network nests one level deeper (see Floresta doc/rpc/auth.md).
NETWORKS: dict[str, Network] = {
    "bitcoin": Network("bitcoin", "", 8332),
    "signet": Network("signet", "signet", 38332),
    "testnet": Network("testnet", "testnet3", 18332),
    "testnet4": Network("testnet4", "testnet4", 48332),
    "regtest": Network("regtest", "regtest", 18442),
}

NETWORK_ALIASES = {
    "main": "bitcoin",
    "mainnet": "bitcoin",
    "testnet3": "testnet",
}


class ConfigError(ValueError):
    """Raised for invalid settings. The message is safe to print."""


def normalize_network(name: str) -> str:
    key = name.strip().lower()
    key = NETWORK_ALIASES.get(key, key)
    if key not in NETWORKS:
        choices = ", ".join(NETWORKS)
        raise ConfigError(f"unknown network {name!r} (choose one of: {choices})")
    return key


def parse_bind(value: str) -> tuple[str, int]:
    """Parse "host:port", "[v6]:port", ":port" or "port"."""
    value = value.strip()
    if not value:
        raise ConfigError("UI_BIND is empty")
    host, port_text = "127.0.0.1", value
    if value.startswith("["):
        end = value.find("]")
        if end == -1 or not value[end + 1 :].startswith(":"):
            raise ConfigError(f"invalid bind address {value!r}")
        host, port_text = value[1:end], value[end + 2 :]
    elif ":" in value:
        host, port_text = value.rsplit(":", 1)
        host = host or "127.0.0.1"
    try:
        port = int(port_text)
    except ValueError:
        raise ConfigError(f"invalid port in bind address {value!r}") from None
    if not 0 <= port <= 65535:
        raise ConfigError(f"port out of range in bind address {value!r}")
    return host, port


def is_loopback_host(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


@dataclass
class Config:
    florestad_url: str = "http://127.0.0.1:8332"
    datadir: Path = field(default_factory=lambda: Path.home() / ".floresta")
    network: str = "bitcoin"
    rpc_user: str | None = None
    rpc_password: str | None = None
    cookie_file: Path | None = None
    bind_host: str = "127.0.0.1"
    bind_port: int = 3000
    allowed_hosts: tuple[str, ...] = ()
    allow_dangerous: bool = False
    static_dir: Path = DEFAULT_STATIC_DIR
    quiet: bool = False
    # True when neither FLORESTA_NETWORK nor FLORESTAD_URL was given: the
    # server then looks for a running florestad on any network.
    auto_network: bool = False
    open_browser: bool = False

    @property
    def cookie_path(self) -> Path:
        return self.cookie_path_for(self.network)

    @property
    def network_dir(self) -> Path:
        return self.network_dir_for(self.network)

    def network_dir_for(self, network: str) -> Path:
        subdir = NETWORKS[network].subdir
        base = self.datadir.expanduser()
        return base / subdir if subdir else base

    def cookie_path_for(self, network: str) -> Path:
        if self.cookie_file is not None:
            path = self.cookie_file.expanduser()
            if not path.is_absolute():
                path = self.network_dir_for(network) / path
            return path
        return self.network_dir_for(network) / ".cookie"

    @property
    def uses_password(self) -> bool:
        # Same rule as florestad: an empty password counts as unset.
        return bool(self.rpc_password)

    @property
    def is_loopback(self) -> bool:
        return is_loopback_host(self.bind_host)

    @property
    def bind_display(self) -> str:
        host = f"[{self.bind_host}]" if ":" in self.bind_host else self.bind_host
        return f"{host}:{self.bind_port}"


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="serve.py",
        description="A small, low-dependency web UI for Floresta.",
    )
    parser.add_argument("--bind", help="address to listen on (env UI_BIND, default 127.0.0.1:3000)")
    parser.add_argument("--florestad-url", help="florestad JSON-RPC URL (env FLORESTAD_URL)")
    parser.add_argument("--datadir", help="florestad data directory (env FLORESTA_DATADIR, default ~/.floresta)")
    parser.add_argument("--network", help="bitcoin, signet, testnet, testnet4 or regtest (env FLORESTA_NETWORK)")
    parser.add_argument("--rpc-user", help="RPC user, used with FLORESTA_RPC_PASSWORD instead of the cookie")
    parser.add_argument("--cookie-file", help="explicit cookie path (env FLORESTA_RPC_COOKIE_FILE)")
    parser.add_argument(
        "--allowed-host",
        action="append",
        default=None,
        help="extra Host header name to accept, e.g. mynode.local (repeatable, env UI_ALLOWED_HOSTS, comma separated)",
    )
    parser.add_argument(
        "--allow-dangerous",
        action="store_true",
        default=None,
        help="also relay stop and sendrawtransaction (env UI_ALLOW_DANGEROUS=1)",
    )
    parser.add_argument("--static-dir", help=argparse.SUPPRESS)
    parser.add_argument("--quiet", action="store_true", help="do not log every request")
    parser.add_argument("--open", action="store_true", help="open the UI in the default browser after starting")
    return parser


def load_config(argv: Sequence[str] | None = None, env: Mapping[str, str] | None = None) -> Config:
    env = os.environ if env is None else env
    args = build_parser().parse_args(argv)

    def pick(flag_value, env_name):
        if flag_value not in (None, ""):
            return flag_value
        value = env.get(env_name)
        return value if value not in (None, "") else None

    network_text = pick(args.network, "FLORESTA_NETWORK")
    network = normalize_network(network_text or "bitcoin")
    florestad_url = pick(args.florestad_url, "FLORESTAD_URL")
    auto_network = network_text is None and florestad_url is None
    if florestad_url is None:
        florestad_url = f"http://127.0.0.1:{NETWORKS[network].rpc_port}"
    if not florestad_url.startswith(("http://", "https://")):
        raise ConfigError("FLORESTAD_URL must start with http:// or https://")

    datadir_text = pick(args.datadir, "FLORESTA_DATADIR")
    datadir = Path(datadir_text).expanduser() if datadir_text else Path.home() / ".floresta"
    cookie_text = pick(args.cookie_file, "FLORESTA_RPC_COOKIE_FILE")

    bind_host, bind_port = parse_bind(pick(args.bind, "UI_BIND") or "127.0.0.1:3000")

    allowed: list[str] = []
    for item in args.allowed_host or []:
        allowed.extend(item.split(","))
    allowed.extend((env.get("UI_ALLOWED_HOSTS") or "").split(","))
    allowed_hosts = tuple(sorted({h.strip().lower() for h in allowed if h.strip()}))

    allow_dangerous = bool(args.allow_dangerous) or _truthy(env.get("UI_ALLOW_DANGEROUS"))

    return Config(
        florestad_url=florestad_url.rstrip("/") or florestad_url,
        datadir=datadir,
        network=network,
        rpc_user=pick(args.rpc_user, "FLORESTA_RPC_USER"),
        rpc_password=env.get("FLORESTA_RPC_PASSWORD") or None,
        cookie_file=Path(cookie_text) if cookie_text else None,
        bind_host=bind_host,
        bind_port=bind_port,
        allowed_hosts=allowed_hosts,
        allow_dangerous=allow_dangerous,
        static_dir=Path(args.static_dir).resolve() if args.static_dir else DEFAULT_STATIC_DIR,
        quiet=bool(args.quiet),
        auto_network=auto_network,
        open_browser=bool(args.open),
    )
