// Polls the node every 5 seconds (paused while the tab is hidden) and shares
// the latest snapshot with the status bar and the views.
import { rpcAll } from "./rpc.js";

const INTERVAL_MS = 5000;

const state = {
  status: "unknown", // unknown | online | offline
  error: null,
  chain: null, // getblockchaininfo
  peers: [],
  peersOk: false,
  uptime: null,
  memory: null, // getmemoryinfo().locked
  roots: null,
  network: null, // getnetworkinfo (fetched once per connection)
  updatedAt: 0,
  height: null,
  heightSince: 0, // when the validated height last changed (ms)
};

const listeners = new Set();
let timer = null;
let inflight = null;
let started = false;

function emit() {
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (err) {
      console.error(err);
    }
  }
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

async function poll() {
  const calls = {
    chain: ["getblockchaininfo", []],
    peers: ["getpeerinfo", []],
    uptime: ["uptime", []],
    memory: ["getmemoryinfo", []],
    roots: ["getroots", []],
  };
  if (!state.network || state.status !== "online") calls.network = ["getnetworkinfo", []];
  const r = await rpcAll(calls);

  if (!r.chain.ok) {
    const err = r.chain.error;
    if (err?.offline || err?.kind === "timeout") {
      state.status = "offline";
      state.error = err;
      state.network = null;
    } else {
      state.error = err;
    }
    state.updatedAt = Date.now();
    return;
  }

  const now = Date.now();
  state.status = "online";
  state.error = null;
  state.chain = r.chain.value;
  if (state.height !== state.chain.blocks) {
    state.height = state.chain.blocks;
    state.heightSince = now;
  }
  state.peersOk = r.peers.ok && Array.isArray(r.peers.value);
  if (state.peersOk) state.peers = r.peers.value;
  if (r.uptime.ok) state.uptime = r.uptime.value;
  if (r.memory.ok) state.memory = r.memory.value?.locked ?? null;
  if (r.roots.ok) state.roots = r.roots.value;
  if (r.network?.ok) state.network = r.network.value;
  state.updatedAt = now;
}

/** Poll right now (e.g. after addnode) and notify listeners. */
export function refresh() {
  if (!inflight) {
    inflight = poll()
      .catch((err) => console.error(err))
      .finally(() => {
        inflight = null;
        emit();
      });
  }
  return inflight;
}

function schedule() {
  clearTimeout(timer);
  if (document.hidden) return;
  timer = setTimeout(async () => {
    await refresh();
    schedule();
  }, INTERVAL_MS);
}

export function startStore() {
  if (started) return;
  started = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(timer);
    } else {
      refresh().then(schedule);
    }
  });
  refresh().then(schedule);
}
