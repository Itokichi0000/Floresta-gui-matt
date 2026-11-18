// The only way the UI talks to the node: POST /api/rpc on the same origin.
// The relay adds credentials; the browser never sees the cookie.

export class RpcError extends Error {
  /**
   * kind: "rpc" (florestad returned an error), "node_unreachable", "auth_failed",
   * "timeout", "method_not_allowed", "ui_unreachable", ...
   */
  constructor(kind, message, code = null) {
    super(message || kind);
    this.name = "RpcError";
    this.kind = kind;
    this.code = code;
  }

  /** True when the node (or this UI's server) cannot be reached at all. */
  get offline() {
    return ["node_unreachable", "ui_unreachable", "auth_failed", "node_busy", "bad_response"].includes(this.kind);
  }
}

export async function rpc(method, params = [], { signal } = {}) {
  let res;
  try {
    res = await fetch("api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
      cache: "no-store",
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new RpcError("ui_unreachable", "Cannot reach the floresta-ui server.");
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const kind = (body && typeof body.error === "string" && body.error) || `http_${res.status}`;
    throw new RpcError(kind, body?.message || kind, res.status);
  }
  if (body?.error) {
    const e = body.error;
    const message = typeof e === "string" ? e : e.message || JSON.stringify(e);
    throw new RpcError("rpc", message, typeof e === "object" ? e.code ?? null : null);
  }
  return body?.result;
}

/** Calls several methods in parallel; returns {name: {ok, value|error}}. */
export async function rpcAll(calls) {
  const entries = Object.entries(calls);
  const settled = await Promise.allSettled(entries.map(([, [m, p]]) => rpc(m, p)));
  const out = {};
  entries.forEach(([name], i) => {
    const r = settled[i];
    out[name] = r.status === "fulfilled" ? { ok: true, value: r.value } : { ok: false, error: r.reason };
  });
  return out;
}
