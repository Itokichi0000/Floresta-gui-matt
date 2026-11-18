#!/usr/bin/env python3
"""A fake florestad for developing and testing floresta-ui.

It speaks JSON-RPC over HTTP with cookie (or user/password) Basic auth,
writes its cookie where florestad would, and answers the methods the UI uses
with responses shaped like Floresta's doc/rpc examples. The chain grows on
its own so the dashboard has something to show.

    python3 server/mock_florestad.py                # signet-like, port 38332
    python3 server/mock_florestad.py --ibd          # still syncing
    python3 server/mock_florestad.py --few-utreexo  # only 1 utreexo peer

Then start the UI with the command it prints. Standard library only.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import ipaddress
import json
import secrets
import signal
import sys
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import NETWORKS, normalize_network  # noqa: E402

GENESIS = {
    "bitcoin": ("000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f", 1231006505),
    "testnet": ("000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943", 1296688602),
    "testnet4": ("00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043", 1714777860),
    "signet": ("00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6", 1598918400),
    "regtest": ("0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206", 1296688602),
}
GENESIS_TXID = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b"

DEFAULT_START_HEIGHT = {
    "bitcoin": 924_310,
    "testnet": 4_701_000,
    "testnet4": 118_400,
    "signet": 271_830,
    "regtest": 120,
}

# Service bits (16 hex digits, like Floresta's getpeerinfo).
NETWORK = 1 << 0
WITNESS = 1 << 3
COMPACT_FILTERS = 1 << 6
NETWORK_LIMITED = 1 << 10
P2P_V2 = 1 << 11
UTREEXO = 1 << 12
UTREEXO_ARCHIVE = 1 << 13
SERVICE_NAMES = [
    (NETWORK, "NETWORK"),
    (WITNESS, "WITNESS"),
    (COMPACT_FILTERS, "COMPACT_FILTERS"),
    (NETWORK_LIMITED, "NETWORK_LIMITED"),
    (P2P_V2, "P2P_V2"),
    (UTREEXO, "UTREEXO"),
    (UTREEXO_ARCHIVE, "UTREEXO_ARCHIVE"),
]

# ---------------------------------------------------------------------------
# Descriptor checksum (BIP 380), so loaddescriptor can add "#xxxxxxxx".

_INPUT_CHARSET = "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ "
_CHECKSUM_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def _polymod(c: int, val: int) -> int:
    c0 = c >> 35
    c = ((c & 0x7FFFFFFFF) << 5) ^ val
    for bit, gen in enumerate((0xF5DEE51989, 0xA9FDCA3312, 0x1BAB10E32D, 0x3706B1677A, 0x644D626FFD)):
        if c0 & (1 << bit):
            c ^= gen
    return c


def descriptor_checksum(desc: str) -> str | None:
    c, cls, clscount = 1, 0, 0
    for ch in desc:
        pos = _INPUT_CHARSET.find(ch)
        if pos == -1:
            return None
        c = _polymod(c, pos & 31)
        cls = cls * 3 + (pos >> 5)
        clscount += 1
        if clscount == 3:
            c, cls, clscount = _polymod(c, cls), 0, 0
    if clscount:
        c = _polymod(c, cls)
    for _ in range(8):
        c = _polymod(c, 0)
    c ^= 1
    return "".join(_CHECKSUM_CHARSET[(c >> (5 * (7 - j))) & 31] for j in range(8))


# ---------------------------------------------------------------------------


class RpcError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def sha_hex(text: str) -> str:
    return hashlib.sha256(hashlib.sha256(text.encode()).digest()).hexdigest()


def services_names(bits: int) -> list[str]:
    return [name for flag, name in SERVICE_NAMES if bits & flag]


@dataclass
class Peer:
    id: int
    address: str
    services: int
    user_agent: str
    kind: str
    state: str
    transport: str
    initial_height: int
    ready_at: float = 0.0

    def to_json(self) -> dict:
        state = self.state
        if state == "Awaiting" and time.time() >= self.ready_at:
            state = self.state = "Ready"
        return {
            "id": self.id,
            "address": self.address,
            "services": f"{self.services:016x}",
            "servicesnames": services_names(self.services),
            "relaytxes": False,
            "user_agent": self.user_agent,
            "inbound": False,
            "bip152_hb_to": False,
            "bip152_hb_from": False,
            "initial_height": self.initial_height,
            "timeoffset": 0,
            "kind": self.kind,
            "state": state,
            "permissions": [],
            "transport_protocol": self.transport,
        }


@dataclass
class MockOptions:
    network: str = "signet"
    start_height: int | None = None
    headers_ahead: int = 0
    ibd: bool = False
    stalled: bool = False
    few_utreexo: bool = False
    block_interval: float = 30.0
    ibd_speed: float = 3.0  # blocks per second while syncing
    getblock_delay: float = 1.0
    getblock_fail: bool = False
    zero_memory: bool = False
    uptime_offset: int = 0


@dataclass
class MockNode:
    options: MockOptions = field(default_factory=MockOptions)

    def __post_init__(self) -> None:
        opts = self.options
        self.network = normalize_network(opts.network)
        self.lock = threading.RLock()
        self.started = time.time()
        start = opts.start_height if opts.start_height is not None else DEFAULT_START_HEIGHT[self.network]
        ahead = opts.headers_ahead or (4_200 if opts.ibd else 0)
        self.headers = start + ahead
        self.height = float(start)
        self.last_tick = self.started
        self.next_block_at = self.started + opts.block_interval
        # Blocks before start are 10 minutes apart, ending ~4 minutes ago.
        self.base_time = int(self.started) - 240 - start * 600
        self.mined_times: dict[int, int] = {}
        self.descriptors: list[str] = []
        self.peers: list[Peer] = []
        self.next_peer_id = 0
        self.rescans: list[list] = []
        self._seed_peers()

    # ----- chain -----------------------------------------------------------

    def tick(self) -> None:
        with self.lock:
            now = time.time()
            if self.options.stalled:
                self.last_tick = now
                return
            if self.height < self.headers:
                self.height = min(self.headers, self.height + (now - self.last_tick) * self.options.ibd_speed)
            elif self.network != "regtest":
                while now >= self.next_block_at:
                    self.headers += 1
                    self.height = float(self.headers)
                    self.mined_times[self.headers] = int(self.next_block_at)
                    self.next_block_at += self.options.block_interval
            self.last_tick = now

    @property
    def blocks(self) -> int:
        return int(self.height)

    def block_hash(self, height: int) -> str:
        if height == 0:
            return GENESIS[self.network][0]
        return "00000000" + sha_hex(f"mock-{self.network}-{height}")[8:]

    def block_time(self, height: int) -> int:
        if height == 0:
            return GENESIS[self.network][1]
        if height in self.mined_times:
            return self.mined_times[height]
        return self.base_time + height * 600

    def height_of(self, blockhash: str) -> int:
        blockhash = blockhash.lower()
        if len(blockhash) != 64 or any(c not in "0123456789abcdef" for c in blockhash):
            raise RpcError(-8, "Invalid block hash")
        if blockhash == GENESIS[self.network][0]:
            return 0
        # Hashes are derived from heights; search near the tip first.
        for h in range(self.headers, max(-1, self.headers - 5000), -1):
            if self.block_hash(h) == blockhash:
                return h
        raise RpcError(-5, "Block not found")

    def num_leaves(self, height: int) -> int:
        return 1_000 + height * 2_771

    def roots(self) -> list[str]:
        leaves = self.num_leaves(self.blocks)
        out = []
        for bit in range(leaves.bit_length() - 1, -1, -1):
            if leaves >> bit & 1:
                out.append(sha_hex(f"root-{self.network}-{self.blocks}-{bit}"))
        return out

    def header_json(self, height: int) -> dict:
        tip = self.headers
        doc = {
            "confirmations": tip - height + 1,
            "height": height,
            "version": 0x20000000 if height else 1,
            "versionHex": "20000000" if height else "00000001",
            "merkleroot": GENESIS_TXID if height == 0 else sha_hex(f"merkle-{height}"),
            "time": self.block_time(height),
            "mediantime": self.block_time(max(0, height - 6)),
            "nonce": int(sha_hex(f"nonce-{height}")[:8], 16),
            "bits": "1d00ffff" if height == 0 else "1e0377ae",
            "target": "00000000ffff0000000000000000000000000000000000000000000000000000",
            "difficulty": 1 if height == 0 else 0.001126515290698186,
            "chainwork": f"{(height + 1) * 4295032833:064x}",
            "nTx": self.n_tx(height),
        }
        if height > 0:
            doc["previousblockhash"] = self.block_hash(height - 1)
        if height < tip:
            doc["nextblockhash"] = self.block_hash(height + 1)
        return doc

    def n_tx(self, height: int) -> int:
        return 1 if height == 0 else 1 + (height * 7919) % 180

    # ----- peers -----------------------------------------------------------

    def _add_peer(self, address, services, agent, kind="outbound-full-relay", state="Ready", transport="V2", ready_in=0.0):
        peer = Peer(
            id=self.next_peer_id,
            address=address,
            services=services,
            user_agent=agent,
            kind=kind,
            state=state,
            transport=transport,
            initial_height=self.headers,
            ready_at=time.time() + ready_in,
        )
        self.next_peer_id += 1
        self.peers.append(peer)
        return peer

    def _seed_peers(self) -> None:
        base = NETWORK | WITNESS | NETWORK_LIMITED | P2P_V2
        port = {"bitcoin": 8333, "signet": 38333, "testnet": 18333, "testnet4": 48333, "regtest": 18444}[self.network]
        self._add_peer(f"198.51.100.23:{port}", base | UTREEXO | UTREEXO_ARCHIVE | COMPACT_FILTERS, "/utreexod:0.4.1/")
        if not self.options.few_utreexo:
            self._add_peer(f"203.0.113.7:{port}", base | UTREEXO, "/Floresta:0.8.0/", kind="block-relay-only")
        self._add_peer(f"192.0.2.44:{port}", base | COMPACT_FILTERS, "/Satoshi:29.0.0/")
        self._add_peer(f"192.0.2.81:{port}", base, "/Satoshi:28.1.0/", transport="V1")
        self._add_peer(f"198.51.100.140:{port}", base, "/Satoshi:29.0.0/")
        self._add_peer(f"[2001:db8::1f]:{port}", base | COMPACT_FILTERS, "/Satoshi:27.2.0/")
        self._add_peer(f"203.0.113.250:{port}", NETWORK | WITNESS, "/btcd:0.24.2/", kind="feeler", transport="V1")
        self._add_peer(f"192.0.2.9:{port}", base, "/Satoshi:29.0.0/", state="Awaiting")

    # ----- RPC dispatch ----------------------------------------------------

    def call(self, method: str, params: list) -> object:
        self.tick()
        handler = getattr(self, f"rpc_{method}", None)
        if handler is None:
            raise RpcError(-32601, "Method not found")
        with self.lock:
            return handler(*params)

    def rpc_getblockchaininfo(self):
        blocks = self.blocks
        tip_time = self.block_time(blocks)
        genesis_time = GENESIS[self.network][1]
        header_time = self.block_time(self.headers)
        progress = (tip_time - genesis_time) / max(1, max(time.time(), header_time) - genesis_time)
        return {
            "bestblockhash": self.block_hash(self.headers),
            "blocks": blocks,
            "initialblockdownload": blocks < self.headers,
            "headers": self.headers,
            "chainwork": f"{(blocks + 1) * 4295032833:064x}",
            "time": tip_time,
            "chain": self.network,
            "verificationprogress": round(min(1.0, progress), 6),
            "difficulty": 0.001126515290698186,
            "mediantime": self.block_time(max(0, blocks - 6)),
            "bits": "1e0377ae",
            "target": "00000377ae000000000000000000000000000000000000000000000000000000",
            "pruned": True,
            "pruneheight": blocks + 1,
            "automatic_pruning": True,
            "prune_target_size": 0,
            "signet_challenge": None,
            "warnings": [],
            "size_on_disk": 412_000_000 + blocks * 81,
        }

    def rpc_getbestblockhash(self):
        return self.block_hash(self.headers)

    def rpc_getblockcount(self):
        return self.blocks

    def rpc_getblockhash(self, height=None):
        if not isinstance(height, int) or isinstance(height, bool) or height < 0 or height > self.headers:
            raise RpcError(-8, "Block height out of range")
        return self.block_hash(height)

    def rpc_getblockheader(self, blockhash=None, verbose=True):
        if not isinstance(blockhash, str):
            raise RpcError(-8, "blockhash must be a string")
        height = self.height_of(blockhash)
        if not verbose:
            return sha_hex(f"header-{height}") * 2 + sha_hex(f"header2-{height}")[:32]
        return self.header_json(height)

    def rpc_getblock(self, blockhash=None, verbosity=1):
        if not isinstance(blockhash, str):
            raise RpcError(-8, "blockhash must be a string")
        height = self.height_of(blockhash)
        # Floresta fetches blocks from peers: slow, and it can fail.
        self.lock.release()
        try:
            time.sleep(self.options.getblock_delay)
        finally:
            self.lock.acquire()
        if self.options.getblock_fail:
            raise RpcError(-1, "Could not fetch block from any peer")
        doc = self.header_json(height)
        n_tx = doc["nTx"]
        txids = [GENESIS_TXID] if height == 0 else [sha_hex(f"tx-{height}-{i}") for i in range(n_tx)]
        size = 285 if height == 0 else 300 + n_tx * 390
        doc.update(
            {
                "size": size,
                "strippedsize": int(size * 0.72) if height else size,
                "weight": int(size * 0.72) * 3 + size if height else size * 4,
                "tx": txids,
            }
        )
        if verbosity == 0:
            return "00" * 80
        return doc

    def rpc_getpeerinfo(self):
        return [p.to_json() for p in self.peers]

    def rpc_getconnectioncount(self):
        return len(self.peers)

    def rpc_getnetworkinfo(self):
        local = NETWORK_LIMITED | WITNESS | P2P_V2 | UTREEXO
        return {
            "version": 900,
            "subversion": "/Floresta:0.9.0-mock/",
            "protocolversion": 70016,
            "localservices": f"{local:016x}",
            "localservicesnames": services_names(local),
            "localrelay": False,
            "timeoffset": 0,
            "connections": len(self.peers),
            "connections_in": 0,
            "connections_out": len(self.peers),
            "networkactive": True,
            "networks": [
                {"name": n, "limited": False, "reachable": n in ("ipv4", "ipv6"), "proxy": "", "proxy_randomize_credentials": False}
                for n in ("ipv4", "ipv6", "onion", "i2p", "cjdns")
            ],
            "relayfee": 0.0,
            "incrementalfee": 0.0,
            "localaddresses": [],
            "warnings": [],
        }

    def rpc_getmemoryinfo(self, mode="stats"):
        if self.options.zero_memory:
            used = free = total = 0
        else:
            used = 48_000_000 + int((time.time() - self.started) * 1500) % 9_000_000
            free, total = 3_000_000, used + 3_000_000
        return {"locked": {"used": used, "free": free, "total": total, "locked": total, "chunks_used": 412, "chunks_free": 9}}

    def rpc_getroots(self):
        return self.roots()

    def rpc_uptime(self):
        return int(time.time() - self.started) + self.options.uptime_offset

    def rpc_getrpcinfo(self):
        return {"active_commands": [{"method": "getrpcinfo", "duration": 12}], "logpath": "/tmp/mock/debug.log"}

    def rpc_getaddrmaninfo(self):
        nets = {n: {"total": 0, "new": 0, "tried": 0} for n in ("ipv4", "ipv6", "onion", "i2p", "cjdns")}
        nets["ipv4"] = {"total": 1200, "new": 1150, "tried": 50}
        nets["ipv6"] = {"total": 140, "new": 130, "tried": 10}
        nets["all_networks"] = {"total": 1340, "new": 1280, "tried": 60}
        return nets

    def rpc_getdeploymentinfo(self, blockhash=None):
        height = self.blocks if blockhash is None else self.height_of(blockhash)
        deps = {name: {"type": "buried", "height": 1, "active": height >= 1, "bip9": None} for name in ("bip34", "bip66", "bip65", "csv", "segwit")}
        return {"hash": self.block_hash(height), "height": height, "deployments": deps}

    # ----- state-changing --------------------------------------------------

    @staticmethod
    def _parse_socket(node: str) -> str:
        text = node.strip()
        host, port = text, None
        if text.startswith("["):
            end = text.find("]")
            if end == -1:
                raise RpcError(-30, "InvalidAddress")
            host, rest = text[1:end], text[end + 1 :]
            port = rest[1:] if rest.startswith(":") else None
        elif text.count(":") == 1:
            host, port = text.split(":")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            raise RpcError(-30, "InvalidAddress") from None
        if port is not None and (not port.isdigit() or not 0 < int(port) < 65536):
            raise RpcError(-30, "InvalidAddress")
        return text

    def rpc_addnode(self, node=None, command=None, v2transport=None):
        if not isinstance(node, str):
            raise RpcError(-30, "InvalidAddress")
        address = self._parse_socket(node)
        if command not in ("add", "remove", "onetry"):
            raise RpcError(-31, "InvalidAddnodeCommand")
        if command == "remove":
            self.peers = [p for p in self.peers if not (p.address == address and p.kind == "manual")]
            return None
        if any(p.address == address for p in self.peers):
            return None
        bits = NETWORK | WITNESS | NETWORK_LIMITED | P2P_V2
        if int(sha_hex(address)[:2], 16) % 2 == 0:
            bits |= UTREEXO
        transport = "V1" if v2transport is False else "V2"
        self._add_peer(address, bits, "/Floresta:0.8.0/", kind="manual", state="Awaiting", transport=transport, ready_in=2.0)
        return None

    def rpc_disconnectnode(self, address="", nodeid=None):
        if address and nodeid is not None:
            raise RpcError(-32, "InvalidDisconnectNodeCommand")
        before = len(self.peers)
        if address:
            self.peers = [p for p in self.peers if p.address != address]
        elif nodeid is not None:
            self.peers = [p for p in self.peers if p.id != nodeid]
        else:
            raise RpcError(-32, "InvalidDisconnectNodeCommand")
        if len(self.peers) == before:
            raise RpcError(-33, "PeerNotFound")
        return None

    def rpc_listdescriptors(self):
        return list(self.descriptors)

    def rpc_loaddescriptor(self, descriptor=None):
        if not isinstance(descriptor, str) or not descriptor.strip():
            raise RpcError(-20, "InvalidDescriptor")
        desc = descriptor.strip()
        if "prv" in desc:
            raise RpcError(-20, "InvalidDescriptor: watch-only wallet, private keys are not allowed")
        if self.blocks < self.headers:
            raise RpcError(-21, "InInitialBlockDownload")
        body, _, given = desc.partition("#")
        checksum = descriptor_checksum(body)
        if checksum is None or (given and given != checksum):
            raise RpcError(-20, "InvalidDescriptor")
        if "(" not in body or not body.endswith(")"):
            raise RpcError(-20, "InvalidDescriptor")
        full = f"{body}#{checksum}"
        if full not in self.descriptors:
            self.descriptors.append(full)
        return True

    def rpc_rescanblockchain(self, start=0, stop=0, use_timestamp=False, confidence="medium"):
        if self.blocks < self.headers:
            raise RpcError(-21, "Node is still syncing")
        if confidence not in ("high", "medium", "low", "exact"):
            raise RpcError(-8, "Invalid confidence")
        if not isinstance(start, int) or not isinstance(stop, int) or start < 0 or stop < 0:
            raise RpcError(-8, "Invalid rescan range")
        if stop and start > stop:
            raise RpcError(-8, "start is greater than stop")
        if use_timestamp:
            genesis_time = GENESIS[self.network][1]
            tip_time = self.block_time(self.blocks)
            if (start and start < genesis_time) or start > tip_time or (stop and stop > tip_time):
                raise RpcError(-8, "Timestamp out of range")
        elif start > self.blocks:
            raise RpcError(-8, "start is beyond the tip")
        self.rescans.append([start, stop, use_timestamp, confidence])
        return True

    def rpc_sendrawtransaction(self, tx=None):
        if not isinstance(tx, str) or len(tx) % 2 or any(c not in "0123456789abcdefABCDEF" for c in tx):
            raise RpcError(-22, "InvalidHex")
        return sha_hex(tx)

    def rpc_stop(self):
        return "Floresta stopping"


# ---------------------------------------------------------------------------
# HTTP server


class MockFlorestad(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, node: MockNode, datadir: Path, port: int = 0, host: str = "127.0.0.1",
                 rpc_user: str | None = None, rpc_password: str | None = None):
        self.node = node
        self.datadir = datadir
        self.rpc_password = rpc_password
        subdir = NETWORKS[node.network].subdir
        self.cookie_path = (datadir / subdir / ".cookie") if subdir else (datadir / ".cookie")
        if rpc_password:
            self.credential = f"{rpc_user or ''}:{rpc_password}"
        else:
            self.credential = f"__cookie__:{secrets.token_hex(32)}"
            self.cookie_path.parent.mkdir(parents=True, exist_ok=True)
            self.cookie_path.write_text(self.credential)
            try:
                self.cookie_path.chmod(0o600)
            except OSError:
                pass
        self.requests_seen = 0
        super().__init__((host, port), MockHandler)

    @property
    def port(self) -> int:
        return self.server_address[1]

    def check_auth(self, header: str | None) -> bool:
        if not header or not header.startswith("Basic "):
            return False
        try:
            decoded = base64.b64decode(header[6:], validate=True).decode()
        except (ValueError, UnicodeDecodeError):
            return False
        return hmac.compare_digest(decoded, self.credential)

    def stop_soon(self) -> None:
        threading.Thread(target=self.shutdown_and_cleanup, daemon=True).start()

    def shutdown_and_cleanup(self) -> None:
        self.shutdown()
        self.server_close()
        self.remove_cookie()

    def remove_cookie(self) -> None:
        if not self.rpc_password:
            try:
                self.cookie_path.unlink()
            except FileNotFoundError:
                pass


class MockHandler(BaseHTTPRequestHandler):
    server: MockFlorestad
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):  # noqa: A002
        if getattr(self.server, "verbose", False):
            sys.stderr.write(f"mock: {format % args}\n")

    def _send(self, status: int, body: bytes, headers: dict | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):  # noqa: N802
        self.server.requests_seen += 1
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        if not self.server.check_auth(self.headers.get("Authorization")):
            self._send(401, b"", {"WWW-Authenticate": 'Basic realm="jsonrpc"'})
            return
        try:
            req = json.loads(raw)
            method = req["method"]
            params = req.get("params") or []
            req_id = req.get("id")
        except (ValueError, KeyError, TypeError):
            self._send(400, b'{"result":null,"error":{"code":-32700,"message":"Parse error"},"id":null}',
                       {"Content-Type": "application/json"})
            return
        if isinstance(params, dict):
            params = list(params.values())
        try:
            result = self.server.node.call(method, params)
            payload = {"jsonrpc": "2.0", "result": result, "error": None, "id": req_id}
            status = 200
        except RpcError as exc:
            payload = {"jsonrpc": "2.0", "result": None, "error": {"code": exc.code, "message": exc.message}, "id": req_id}
            status = 500
        except TypeError:
            payload = {"jsonrpc": "2.0", "result": None, "error": {"code": -32602, "message": "Invalid params"}, "id": req_id}
            status = 500
        self._send(status, json.dumps(payload).encode(), {"Content-Type": "application/json"})
        if method == "stop" and status == 200:
            self.server.stop_soon()


def start_mock(datadir: Path, options: MockOptions | None = None, port: int = 0, **kwargs) -> MockFlorestad:
    """Start a mock in a background thread (used by the tests)."""
    server = MockFlorestad(MockNode(options or MockOptions()), Path(datadir), port=port, **kwargs)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Fake florestad for floresta-ui development.")
    p.add_argument("--network", default="signet")
    p.add_argument("--port", type=int, help="RPC port (default: the network's florestad port)")
    p.add_argument("--datadir", default=str(Path(__file__).resolve().parent.parent / "tmp" / "mock-floresta"),
                   help="where to write the cookie (default: ./tmp/mock-floresta)")
    p.add_argument("--rpc-user")
    p.add_argument("--rpc-password")
    p.add_argument("--start-height", type=int)
    p.add_argument("--ibd", action="store_true", help="start behind the header tip and sync")
    p.add_argument("--stalled", action="store_true", help="never advance the chain")
    p.add_argument("--few-utreexo", action="store_true", help="only one utreexo-capable peer")
    p.add_argument("--block-interval", type=float, default=30.0, help="seconds between new blocks")
    p.add_argument("--getblock-delay", type=float, default=1.0)
    p.add_argument("--getblock-fail", action="store_true", help="make getblock always fail")
    p.add_argument("--zero-memory", action="store_true", help="getmemoryinfo returns zeros")
    p.add_argument("--uptime-offset", type=int, default=273_600, help="seconds added to uptime (default 3d4h)")
    p.add_argument("--verbose", action="store_true")
    args = p.parse_args(argv)

    network = normalize_network(args.network)
    options = MockOptions(
        network=network, start_height=args.start_height, ibd=args.ibd, stalled=args.stalled,
        few_utreexo=args.few_utreexo, block_interval=args.block_interval,
        getblock_delay=args.getblock_delay, getblock_fail=args.getblock_fail,
        zero_memory=args.zero_memory, uptime_offset=args.uptime_offset,
    )
    port = args.port or NETWORKS[network].rpc_port
    datadir = Path(args.datadir).expanduser().resolve()
    server = MockFlorestad(MockNode(options), datadir, port=port, rpc_user=args.rpc_user, rpc_password=args.rpc_password)
    server.verbose = args.verbose
    sys.stderr.write(f"mock florestad ({network}) listening on 127.0.0.1:{server.port}\n")
    if not args.rpc_password:
        sys.stderr.write(f"cookie written to {server.cookie_path}\n")
    sys.stderr.write(
        "start the UI with:\n"
        f"  FLORESTA_NETWORK={network} FLORESTA_DATADIR={datadir} FLORESTAD_URL=http://127.0.0.1:{server.port} "
        "python3 server/serve.py\n"
    )
    def on_term(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, on_term)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        server.remove_cookie()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
