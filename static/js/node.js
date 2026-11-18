// Pure helpers that interpret Floresta's RPC answers (no DOM, no fetch).

export const UTREEXO_BIT = 1n << 12n;
export const UTREEXO_ARCHIVE_BIT = 1n << 13n;
export const MIN_UTREEXO_PEERS = 2; // Floresta does not make progress with fewer
export const STALL_MS = 10 * 60 * 1000;
export const TIP_STALE_SECONDS = 60 * 60;

// Older releases (florestad <= 0.9) print services as "ServiceFlags(NETWORK|WITNESS|0x1000000)"
// and used bit 24 for Utreexo.
const LEGACY_UTREEXO_BIT = 1n << 24n;
const NAMED_BITS = {
  NETWORK: 1n, GETUTXO: 2n, BLOOM: 4n, WITNESS: 8n, COMPACT_FILTERS: 64n,
  NETWORK_LIMITED: 1024n, P2P_V2: 2048n, UTREEXO: UTREEXO_BIT, UTREEXO_ARCHIVE: UTREEXO_ARCHIVE_BIT,
};

/** services is a 16-digit hex string in Floresta's getpeerinfo. */
export function serviceBits(services) {
  if (typeof services !== "string") return 0n;
  if (/^[0-9a-fA-F]{1,16}$/.test(services)) return BigInt(`0x${services}`);
  let bits = 0n;
  for (const token of services.match(/0x[0-9a-fA-F]+|[A-Z][A-Z0-9_]*/g) || []) {
    if (token.startsWith("0x")) bits |= BigInt(token);
    else if (token in NAMED_BITS) bits |= NAMED_BITS[token];
  }
  if (bits & LEGACY_UTREEXO_BIT) bits |= UTREEXO_BIT;
  return bits;
}

/** Service names: servicesnames when present, otherwise derived from the bits. */
export function serviceNames(peer) {
  if (Array.isArray(peer?.servicesnames)) return peer.servicesnames;
  const bits = serviceBits(peer?.services);
  return Object.entries(NAMED_BITS).filter(([, b]) => bits & b).map(([n]) => n);
}

export function peerUtreexo(peer) {
  const bits = serviceBits(peer?.services);
  return {
    utreexo: (bits & UTREEXO_BIT) !== 0n,
    archive: (bits & UTREEXO_ARCHIVE_BIT) !== 0n,
  };
}

/**
 * getblockchaininfo with Bitcoin Core field names. florestad <= 0.9 used
 * best_block / height / validated / ibd / progress / latest_block_time.
 */
export function normalizeChainInfo(c) {
  if (!c || typeof c !== "object" || ("blocks" in c && "bestblockhash" in c)) return c;
  return {
    ...c,
    bestblockhash: c.bestblockhash ?? c.best_block,
    headers: c.headers ?? c.height,
    blocks: c.blocks ?? c.validated ?? c.height,
    initialblockdownload: c.initialblockdownload ?? c.ibd,
    verificationprogress: c.verificationprogress ?? c.progress,
    time: c.time ?? c.latest_block_time,
    legacy: true,
  };
}

/** getblockheader in the Core shape. Old releases return only the raw header fields. */
export function normalizeHeader(hd, { height, tip } = {}) {
  if (!hd || typeof hd !== "object" || "merkleroot" in hd) return hd;
  const prev = hd.prev_blockhash;
  return {
    ...hd,
    height: hd.height ?? height,
    confirmations: hd.confirmations ?? (height !== undefined && tip !== undefined ? tip - height + 1 : undefined),
    merkleroot: hd.merkle_root,
    previousblockhash: prev && !/^0+$/.test(prev) ? prev : undefined,
    bits: typeof hd.bits === "number" ? hd.bits.toString(16).padStart(8, "0") : hd.bits,
    versionHex: (Number(hd.version) >>> 0).toString(16).padStart(8, "0"),
    legacy: true,
  };
}

export function countUtreexo(peers) {
  return (peers || []).filter((p) => peerUtreexo(p).utreexo).length;
}

export function isSyncing(chain) {
  return Boolean(chain && (chain.initialblockdownload || chain.blocks < chain.headers));
}

/**
 * The sync looks stuck when the validated height has not moved for 10
 * minutes while we are behind (or the tip block is over an hour old).
 */
export function isStalled(state, nowMs = Date.now()) {
  const chain = state.chain;
  if (!chain || !state.heightSince) return false;
  if (nowMs - state.heightSince < STALL_MS) return false;
  if (isSyncing(chain)) return true;
  if (chain.chain === "regtest") return false;
  return nowMs / 1000 - (chain.time || 0) > TIP_STALE_SECONDS;
}

/**
 * What the forest girl should say, from most to least urgent.
 * reason: offline | auth | few_utreexo | stalled | syncing | synced | loading
 * mood:   sleeping | worried | determined | happy
 */
export function nodeSituation(state, nowMs = Date.now()) {
  if (state.status === "unknown") return { reason: "loading", mood: "determined" };
  if (state.status === "offline") {
    return { reason: state.error?.kind === "auth_failed" ? "auth" : "offline", mood: "sleeping" };
  }
  const utreexo = countUtreexo(state.peers);
  if (state.peersOk && utreexo < MIN_UTREEXO_PEERS) return { reason: "few_utreexo", mood: "worried", utreexo };
  if (isStalled(state, nowMs)) return { reason: "stalled", mood: "worried", utreexo };
  if (isSyncing(state.chain)) return { reason: "syncing", mood: "determined", utreexo };
  return { reason: "synced", mood: "happy", utreexo };
}
