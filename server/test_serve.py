"""Tests for floresta-ui's server. Run: python3 -m unittest discover -s server

Each test starts a mock florestad (server/mock_florestad.py) and the UI
server on free ports, then talks to them over real HTTP.
"""

from __future__ import annotations

import http.client
import json
import socket
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import ConfigError, load_config, parse_bind  # noqa: E402
from mock_florestad import MockOptions, start_mock  # noqa: E402
from serve import UIServer  # noqa: E402


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Harness:
    """A running mock florestad + UI server."""

    def __init__(self, tc: unittest.TestCase, *, network="regtest", ui_args=(), env=None,
                 mock_options=None, start_node=True, rpc_user=None, rpc_password=None):
        self.tmp = tempfile.TemporaryDirectory()
        tc.addCleanup(self.tmp.cleanup)
        self.datadir = Path(self.tmp.name)
        self.network = network
        self.node_port = free_port()
        self.rpc_user, self.rpc_password = rpc_user, rpc_password
        self.mock_options = mock_options or MockOptions(network=network, getblock_delay=0.0)
        self.mock = None
        if start_node:
            self.start_node()
        base_env = {
            "FLORESTA_DATADIR": str(self.datadir),
            "FLORESTA_NETWORK": network,
            "FLORESTAD_URL": f"http://127.0.0.1:{self.node_port}",
            "UI_BIND": "127.0.0.1:0",
        }
        base_env.update(env or {})
        config = load_config(["--quiet", *ui_args], env=base_env)
        self.ui = UIServer(config)
        threading.Thread(target=self.ui.serve_forever, daemon=True).start()
        tc.addCleanup(self.close)

    def start_node(self):
        self.mock = start_mock(self.datadir, self.mock_options, port=self.node_port,
                               rpc_user=self.rpc_user, rpc_password=self.rpc_password)
        return self.mock

    def stop_node(self):
        if self.mock is not None:
            self.mock.shutdown_and_cleanup()
            self.mock = None

    def close(self):
        self.stop_node()
        self.ui.shutdown()
        self.ui.server_close()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.ui.port, timeout=40)
        hdrs = {"Host": f"127.0.0.1:{self.ui.port}"}
        hdrs.update(headers or {})
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
            hdrs.setdefault("Content-Type", "application/json")
        conn.request(method, path, body=body, headers=hdrs)
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        return resp, data

    def rpc(self, method, params=None, headers=None):
        payload = {"method": method}
        if params is not None:
            payload["params"] = params
        resp, data = self.request("POST", "/api/rpc", payload, headers)
        return resp.status, json.loads(data)


class ConfigTests(unittest.TestCase):
    def test_defaults(self):
        cfg = load_config([], env={})
        self.assertEqual(cfg.florestad_url, "http://127.0.0.1:8332")
        self.assertEqual((cfg.bind_host, cfg.bind_port), ("127.0.0.1", 3000))
        self.assertEqual(cfg.cookie_path, Path.home() / ".floresta" / ".cookie")
        self.assertFalse(cfg.allow_dangerous)

    def test_network_switches_port_and_cookie(self):
        expected = {"signet": 38332, "testnet4": 48332, "regtest": 18442, "testnet": 18332}
        for net, port in expected.items():
            cfg = load_config([], env={"FLORESTA_NETWORK": net, "FLORESTA_DATADIR": "/data"})
            self.assertEqual(cfg.florestad_url, f"http://127.0.0.1:{port}")
            sub = "testnet3" if net == "testnet" else net
            self.assertEqual(cfg.cookie_path, Path("/data") / sub / ".cookie")

    def test_mainnet_alias_and_flags_override_env(self):
        cfg = load_config(["--network", "mainnet", "--bind", "0.0.0.0:3100"], env={"FLORESTA_NETWORK": "signet"})
        self.assertEqual(cfg.network, "bitcoin")
        self.assertEqual(cfg.bind_port, 3100)
        self.assertFalse(cfg.is_loopback)

    def test_bad_values(self):
        with self.assertRaises(ConfigError):
            load_config([], env={"FLORESTA_NETWORK": "dogecoin"})
        with self.assertRaises(ConfigError):
            parse_bind("localhost:http")

    def test_parse_bind(self):
        self.assertEqual(parse_bind("[::1]:3000"), ("::1", 3000))
        self.assertEqual(parse_bind(":4000"), ("127.0.0.1", 4000))
        self.assertEqual(parse_bind("4000"), ("127.0.0.1", 4000))


class StaticTests(unittest.TestCase):
    def setUp(self):
        self.h = Harness(self, start_node=False)

    def test_index_served_with_security_headers(self):
        resp, body = self.h.request("GET", "/")
        self.assertEqual(resp.status, 200)
        self.assertIn(b'<main id="main"', body)
        self.assertIn("default-src 'self'", resp.getheader("Content-Security-Policy"))
        self.assertEqual(resp.getheader("X-Content-Type-Options"), "nosniff")

    def test_content_types(self):
        resp, _ = self.h.request("GET", "/js/app.js")
        self.assertTrue(resp.getheader("Content-Type").startswith("text/javascript"))
        resp, _ = self.h.request("GET", "/i18n/en.json")
        self.assertTrue(resp.getheader("Content-Type").startswith("application/json"))

    def test_path_traversal_blocked(self):
        for path in ("/../server/config.py", "/%2e%2e/server/config.py", "/css/../../LICENSE", "/.git/config"):
            resp, _ = self.h.request("GET", path)
            self.assertEqual(resp.status, 404, path)

    def test_unknown_host_rejected(self):
        resp, body = self.h.request("GET", "/", headers={"Host": "evil.example:3000"})
        self.assertEqual(resp.status, 403)
        self.assertEqual(json.loads(body)["error"], "host_not_allowed")

    def test_localhost_and_ip_hosts_allowed(self):
        for host in ("localhost:3000", "127.0.0.1:8080", "[::1]:3000", "192.168.1.20:3000"):
            resp, _ = self.h.request("GET", "/", headers={"Host": host})
            self.assertEqual(resp.status, 200, host)

    def test_info(self):
        resp, body = self.h.request("GET", "/api/info")
        info = json.loads(body)
        self.assertEqual(info["network"], "regtest")
        self.assertIn("getblockcount", info["methods"]["read"])
        self.assertEqual(info["methods"]["dangerous"], [])


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.h = Harness(self)

    def test_getblockcount_returns_height(self):
        status, body = self.h.rpc("getblockcount")
        self.assertEqual(status, 200)
        self.assertIsInstance(body["result"], int)
        self.assertIsNone(body["error"])

    def test_curl_style_form_content_type_is_accepted(self):
        # curl -d sends application/x-www-form-urlencoded and no browser headers.
        resp, data = self.h.request("POST", "/api/rpc", b'{"method":"getblockcount"}',
                                    {"Content-Type": "application/x-www-form-urlencoded"})
        self.assertEqual(resp.status, 200)
        self.assertIsInstance(json.loads(data)["result"], int)

    def test_params_are_forwarded(self):
        status, body = self.h.rpc("getblockhash", [0])
        self.assertEqual(status, 200)
        self.assertEqual(body["result"], "0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206")

    def test_rpc_errors_are_passed_through(self):
        status, body = self.h.rpc("getblockhash", [10**9])
        self.assertEqual(status, 200)
        self.assertIsNone(body["result"])
        self.assertEqual(body["error"]["code"], -8)

    def test_stop_is_forbidden_by_default(self):
        status, body = self.h.rpc("stop")
        self.assertEqual(status, 403)
        self.assertEqual(body, {"error": "method_not_allowed"})
        self.assertIsNotNone(self.h.mock)  # node still running
        self.assertEqual(self.h.rpc("getblockcount")[0], 200)

    def test_unknown_method_forbidden(self):
        for method in ("getrawtransaction", "dumpprivkey", "__proto__", ""):
            status, body = self.h.rpc(method)
            self.assertEqual(status, 403, method)
            self.assertEqual(body["error"], "method_not_allowed")

    def test_write_methods_allowed(self):
        status, body = self.h.rpc("addnode", ["192.0.2.200:18444", "add"])
        self.assertEqual(status, 200)
        self.assertIsNone(body["error"])
        peers = self.h.rpc("getpeerinfo")[1]["result"]
        self.assertIn("192.0.2.200:18444", [p["address"] for p in peers])

    def test_node_unreachable(self):
        self.h.stop_node()
        status, body = self.h.rpc("getblockcount")
        self.assertEqual(status, 502)
        self.assertEqual(body, {"error": "node_unreachable"})

    def test_cookie_rotation_after_restart(self):
        first = self.h.mock.credential
        self.h.stop_node()
        self.assertEqual(self.h.rpc("getblockcount")[0], 502)
        self.h.start_node()
        self.assertNotEqual(first, self.h.mock.credential)
        status, body = self.h.rpc("getblockcount")
        self.assertEqual(status, 200)
        self.assertIsInstance(body["result"], int)

    def test_reloads_cookie_on_401_even_if_mtime_matches(self):
        self.assertEqual(self.h.rpc("getblockcount")[0], 200)
        # Rotate the credential server-side and rewrite the file keeping its mtime.
        import os
        path = self.h.mock.cookie_path
        st = path.stat()
        self.h.mock.credential = "__cookie__:" + "ab" * 32
        path.write_text(self.h.mock.credential)
        os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns))
        self.assertEqual(self.h.rpc("getblockcount")[0], 200)

    def test_wrong_cookie_reports_auth_failed_without_leaking(self):
        secret = "__cookie__:" + "cd" * 32
        self.h.mock.cookie_path.write_text(secret)  # file no longer matches the node
        status, body = self.h.rpc("getblockcount")
        self.assertEqual(status, 502)
        self.assertEqual(body["error"], "auth_failed")
        self.assertNotIn("cd" * 32, json.dumps(body))
        self.assertNotIn(self.h.mock.credential.split(":")[1], json.dumps(body))

    def test_origin_must_match(self):
        port = self.h.ui.port
        status, body = self.h.rpc("getblockcount", headers={"Origin": "http://evil.example"})
        self.assertEqual(status, 403)
        self.assertEqual(body["error"], "origin_not_allowed")
        status, body = self.h.rpc("getblockcount", headers={"Origin": "null"})
        self.assertEqual(status, 403)
        status, _ = self.h.rpc("getblockcount", headers={"Origin": f"http://127.0.0.1:{port}"})
        self.assertEqual(status, 200)

    def test_browser_requests_need_json_content_type(self):
        port = self.h.ui.port
        resp, data = self.h.request(
            "POST", "/api/rpc", b'{"method":"getblockcount"}',
            {"Content-Type": "text/plain", "Origin": f"http://127.0.0.1:{port}"},
        )
        self.assertEqual(resp.status, 415)
        resp, data = self.h.request(
            "POST", "/api/rpc", b'{"method":"getblockcount"}',
            {"Content-Type": "text/plain", "Sec-Fetch-Site": "cross-site"},
        )
        self.assertEqual(resp.status, 415)

    def test_bad_requests(self):
        resp, data = self.h.request("POST", "/api/rpc", b"not json", {"Content-Type": "application/json"})
        self.assertEqual(resp.status, 400)
        resp, data = self.h.request("POST", "/api/rpc", {"params": []})
        self.assertEqual(resp.status, 400)
        resp, data = self.h.request("POST", "/api/rpc", {"method": "getblockhash", "params": "0"})
        self.assertEqual(resp.status, 400)
        resp, data = self.h.request("POST", "/api/rpc", b"x" * (70 * 1024), {"Content-Type": "application/json"})
        self.assertEqual(resp.status, 413)

    def test_other_http_methods(self):
        resp, _ = self.h.request("PUT", "/api/rpc", b"{}")
        self.assertEqual(resp.status, 405)
        resp, _ = self.h.request("GET", "/api/rpc")
        self.assertEqual(resp.status, 404)


class DangerousTests(unittest.TestCase):
    def test_allow_dangerous_relays_stop(self):
        h = Harness(self, ui_args=["--allow-dangerous"])
        status, body = h.rpc("stop")
        self.assertEqual(status, 200)
        self.assertEqual(body["result"], "Floresta stopping")


class PasswordAuthTests(unittest.TestCase):
    def test_user_password_instead_of_cookie(self):
        h = Harness(self, rpc_user="alice", rpc_password="hunter2",
                    env={"FLORESTA_RPC_USER": "alice", "FLORESTA_RPC_PASSWORD": "hunter2"})
        self.assertFalse(h.mock.cookie_path.exists())
        status, body = h.rpc("getblockcount")
        self.assertEqual(status, 200)

    def test_wrong_password(self):
        h = Harness(self, rpc_user="alice", rpc_password="hunter2",
                    env={"FLORESTA_RPC_USER": "alice", "FLORESTA_RPC_PASSWORD": "wrong-pass"})
        status, body = h.rpc("getblockcount")
        self.assertEqual(status, 502)
        self.assertEqual(body["error"], "auth_failed")
        self.assertNotIn("wrong-pass", json.dumps(body))
        self.assertNotIn("hunter2", json.dumps(body))


class TimeoutTests(unittest.TestCase):
    def test_slow_node_times_out(self):
        import serve
        h = Harness(self, mock_options=MockOptions(network="regtest", getblock_delay=1.5))
        old = dict(serve.SLOW_METHOD_TIMEOUTS)
        serve.SLOW_METHOD_TIMEOUTS["getblock"] = 0.3
        self.addCleanup(lambda: serve.SLOW_METHOD_TIMEOUTS.update(old))
        genesis = h.rpc("getblockhash", [0])[1]["result"]
        status, body = h.rpc("getblock", [genesis, 1])
        self.assertEqual(status, 504)
        self.assertEqual(body["error"], "timeout")


class AutoNetworkTests(unittest.TestCase):
    """Without FLORESTA_NETWORK / FLORESTAD_URL the server finds the running node."""

    def test_detects_network_from_listening_port_and_cookie(self):
        port = 18442  # regtest's default RPC port
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                self.skipTest("port 18442 is in use")
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        mock = start_mock(Path(tmp.name), MockOptions(network="regtest", getblock_delay=0.0), port=port)
        self.addCleanup(mock.shutdown_and_cleanup)
        config = load_config(["--quiet"], env={"FLORESTA_DATADIR": tmp.name, "UI_BIND": "127.0.0.1:0"})
        self.assertTrue(config.auto_network)
        self.assertEqual(config.network, "bitcoin")
        ui = UIServer(config)
        threading.Thread(target=ui.serve_forever, daemon=True).start()
        self.addCleanup(ui.server_close)
        self.addCleanup(ui.shutdown)
        ui.client.detect_network(force=True)
        self.assertEqual(config.network, "regtest")
        self.assertEqual(config.florestad_url, f"http://127.0.0.1:{port}")
        self.assertEqual(config.cookie_path, Path(tmp.name) / "regtest" / ".cookie")
        result = ui.client.call("getblockcount", [])
        self.assertIsInstance(result["result"], int)

    def test_explicit_network_disables_detection(self):
        config = load_config([], env={"FLORESTA_NETWORK": "signet"})
        self.assertFalse(config.auto_network)
        config = load_config([], env={"FLORESTAD_URL": "http://127.0.0.1:9999"})
        self.assertFalse(config.auto_network)


class MockNodeTests(unittest.TestCase):
    """Sanity checks that the mock behaves like Floresta's documented RPCs."""

    def setUp(self):
        self.h = Harness(self, network="signet")

    def test_blockchaininfo_fields(self):
        info = self.h.rpc("getblockchaininfo")[1]["result"]
        for key in ("bestblockhash", "blocks", "headers", "initialblockdownload", "verificationprogress", "time", "size_on_disk", "chain"):
            self.assertIn(key, info)
        self.assertEqual(info["chain"], "signet")

    def test_roots_match_popcount(self):
        roots = self.h.rpc("getroots")[1]["result"]
        node = self.h.mock.node
        self.assertEqual(len(roots), bin(node.num_leaves(node.blocks)).count("1"))
        self.assertTrue(all(len(r) == 64 for r in roots))

    def test_descriptor_rejects_private_keys(self):
        status, body = self.h.rpc("loaddescriptor", ["wpkh(tprv8ZgxMBicQKsPd/0/*)"])
        self.assertIsNotNone(body["error"])
        ok = self.h.rpc("loaddescriptor", [
            "wpkh(tpubDDtyive2LqLWKzPZ8LZ9Ebi1JDoLcf1cEpn3Mshp6sxVfCupHZJRPQTozp2EpTF76vJcyQBN7VP7CjUntEJxeADnuTMNTYKoSWNae8soVyv/0/*)"
        ])[1]
        self.assertTrue(ok["result"])
        listed = self.h.rpc("listdescriptors")[1]["result"]
        self.assertEqual(listed[0][-9:], "#7h6kdtnk")

    def test_peer_services_are_hex(self):
        peers = self.h.rpc("getpeerinfo")[1]["result"]
        utreexo = [p for p in peers if int(p["services"], 16) & (1 << 12)]
        self.assertEqual(len(utreexo), 2)
        self.assertTrue(all(len(p["services"]) == 16 for p in peers))


if __name__ == "__main__":
    unittest.main()
