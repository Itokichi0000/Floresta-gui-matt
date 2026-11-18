// Pure helpers that interpret Floresta's RPC answers (no DOM, no fetch).

export const UTREEXO_BIT = 1n << 12n;
export const UTREEXO_ARCHIVE_BIT = 1n << 13n;
export const MIN_UTREEXO_PEERS = 2; // Floresta does not make progress with fewer
export const STALL_MS = 10 * 60 * 1000;
export const TIP_STALE_SECONDS = 60 * 60;

/** services is a 16-digit hex string in Floresta's getpeerinfo. */
export function serviceBits(services) {
  if (typeof services !== "string" || !/^[0-9a-fA-F]{1,16}$/.test(services)) return 0n;
  try {
    return BigInt(`0x${services}`);
  } catch {
    return 0n;
  }
}

export function peerUtreexo(peer) {
  const bits = serviceBits(peer?.services);
  return {
    utreexo: (bits & UTREEXO_BIT) !== 0n,
    archive: (bits & UTREEXO_ARCHIVE_BIT) !== 0n,
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
