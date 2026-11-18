// Unit tests for the pure helpers in static/js. Run: node --test tests/js
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countUtreexo, isStalled, nodeSituation, normalizeChainInfo, normalizeHeader,
  peerUtreexo, serviceBits, serviceNames,
} from "../../static/js/node.js";
import { formatPercent, shortHash } from "../../static/js/format.js";

test("service bits from 16-digit hex (Floresta master)", () => {
  assert.deepEqual(peerUtreexo({ services: "0000000000001c09" }), { utreexo: true, archive: false });
  assert.deepEqual(peerUtreexo({ services: "0000000000003c09" }), { utreexo: true, archive: true });
  assert.deepEqual(peerUtreexo({ services: "0000000000000c09" }), { utreexo: false, archive: false });
  assert.equal(serviceBits("zz"), 0n);
  assert.equal(serviceBits(undefined), 0n);
});

test("service flags in the old ServiceFlags(...) form", () => {
  const peer = { services: "ServiceFlags(NETWORK|WITNESS|NETWORK_LIMITED|0x1000000)" };
  assert.equal(peerUtreexo(peer).utreexo, true);
  assert.deepEqual(serviceNames(peer), ["NETWORK", "WITNESS", "NETWORK_LIMITED", "UTREEXO"]);
});

test("countUtreexo", () => {
  const peers = [{ services: "0000000000001009" }, { services: "0000000000000009" }, { services: "0000000000002000" }];
  assert.equal(countUtreexo(peers), 1);
});

test("normalizeChainInfo keeps Core names and maps the 0.9 ones", () => {
  const core = { blocks: 5, bestblockhash: "aa", headers: 5 };
  assert.equal(normalizeChainInfo(core), core);
  const old = normalizeChainInfo({ best_block: "bb", height: 100, validated: 40, ibd: true, progress: 0.4, latest_block_time: 7, leaf_count: 9 });
  assert.equal(old.bestblockhash, "bb");
  assert.equal(old.headers, 100);
  assert.equal(old.blocks, 40);
  assert.equal(old.initialblockdownload, true);
  assert.equal(old.verificationprogress, 0.4);
  assert.equal(old.time, 7);
  assert.equal(old.leaf_count, 9);
});

test("normalizeHeader maps the raw header fields", () => {
  const hd = normalizeHeader(
    { bits: 503543726, merkle_root: "m", nonce: 1, prev_blockhash: "0".repeat(64), time: 2, version: 1 },
    { height: 0, tip: 10 },
  );
  assert.equal(hd.merkleroot, "m");
  assert.equal(hd.previousblockhash, undefined);
  assert.equal(hd.bits, "1e0377ae");
  assert.equal(hd.versionHex, "00000001");
  assert.equal(hd.confirmations, 11);
});

test("situation: offline, few utreexo, syncing, synced", () => {
  const now = Date.now();
  const utreexoPeers = [{ services: "0000000000001000" }, { services: "0000000000001000" }];
  assert.equal(nodeSituation({ status: "offline", error: { kind: "node_unreachable" } }).mood, "sleeping");
  assert.equal(nodeSituation({ status: "offline", error: { kind: "auth_failed" } }).reason, "auth");
  const base = { status: "online", peersOk: true, heightSince: now };
  assert.equal(nodeSituation({ ...base, peers: [utreexoPeers[0]], chain: { blocks: 1, headers: 1 } }).reason, "few_utreexo");
  assert.equal(nodeSituation({ ...base, peers: utreexoPeers, chain: { blocks: 1, headers: 9, initialblockdownload: true } }).reason, "syncing");
  assert.equal(nodeSituation({ ...base, peers: utreexoPeers, chain: { blocks: 9, headers: 9, time: now / 1000 } }).reason, "synced");
});

test("stall: 10 minutes without progress while syncing", () => {
  const now = Date.now();
  const chain = { blocks: 1, headers: 9, initialblockdownload: true };
  assert.equal(isStalled({ chain, heightSince: now - 9 * 60_000 }, now), false);
  assert.equal(isStalled({ chain, heightSince: now - 11 * 60_000 }, now), true);
  // Caught up on regtest: no new blocks is normal.
  assert.equal(isStalled({ chain: { blocks: 9, headers: 9, chain: "regtest", time: 0 }, heightSince: now - 3600_000 }, now), false);
});

test("formatting", () => {
  assert.equal(formatPercent(0.99999), "99.99%");
  assert.equal(formatPercent(1), "100.00%");
  assert.equal(shortHash("0123456789abcdef0123", 4, 4), "0123…0123");
});
