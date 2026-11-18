// PARTY (#/peers): connected peers, Utreexo highlight, addnode / disconnectnode (design doc 5.2).
import { h, icon } from "../dom.js";
import { formatNumber } from "../format.js";
import { t } from "../i18n.js";
import { rpc } from "../rpc.js";
import { countUtreexo, MIN_UTREEXO_PEERS, peerUtreexo } from "../node.js";
import { refresh, subscribe } from "../store.js";
import { confirmDialog, errorText, pageHead, toast, windowTab } from "../ui.js";

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** Accepts 1.2.3.4, 1.2.3.4:8333, [2001:db8::1]:8333 and bare IPv6. */
export function validAddress(text) {
  const s = text.trim();
  let host = s;
  let port = null;
  if (s.startsWith("[")) {
    const m = /^\[([0-9a-fA-F:.]+)\](?::(\d+))?$/.exec(s);
    if (!m) return false;
    [, host, port] = m;
    if (!host.includes(":")) return false;
  } else if ((s.match(/:/g) || []).length === 1) {
    [host, port] = s.split(":");
    if (!IPV4.test(host)) return false;
  } else if (s.includes(":")) {
    if (!/^[0-9a-fA-F:.]+$/.test(s) || !/::|(:.*){7}/.test(s)) return false;
  } else if (!IPV4.test(host)) {
    return false;
  }
  if (port !== null && port !== undefined) {
    const n = Number(port);
    if (!/^\d{1,5}$/.test(port) || n < 1 || n > 65535) return false;
  }
  return true;
}

// Short chip labels; the full service name is in the tooltip.
const SHORT_NAMES = {
  NETWORK: "NET",
  WITNESS: "WIT",
  NETWORK_LIMITED: "LIMITED",
  COMPACT_FILTERS: "FILTERS",
  P2P_V2: "V2",
  UTREEXO: "UTREEXO",
  UTREEXO_ARCHIVE: "ARCHIVE",
  BLOOM: "BLOOM",
};

function serviceChips(peer) {
  const names = Array.isArray(peer.servicesnames) ? [...peer.servicesnames] : [];
  const flags = peerUtreexo(peer);
  if (flags.utreexo && !names.some((n) => n.startsWith("UTREEXO"))) names.push("UTREEXO");
  if (flags.archive && !names.includes("UTREEXO_ARCHIVE")) names.push("UTREEXO_ARCHIVE");
  return h("span", { class: "chips" },
    names.map((n) => h("span", { class: ["chip", "chip-xs", n.startsWith("UTREEXO") && "is-green"], title: n }, SHORT_NAMES[n] || n.replace(/_/g, " "))));
}

function stateChip(state) {
  const tone = state === "Ready" ? "is-green" : state === "Banned" ? "is-pink" : "is-gold";
  return h("span", { class: ["chip", tone] }, state || "?");
}

export function mount(root, _params, ctx) {
  // ----- summary --------------------------------------------------------
  const sumUtreexo = h("span", { class: "big-num mono" }, "—");
  const sumTotal = h("span", { class: "big-num mono" }, "—");
  const warn = h("div", { class: "banner-slot" });

  // ----- invite form ----------------------------------------------------
  const input = h("input", {
    class: "input mono", id: "invite-addr", name: "address", autocomplete: "off", spellcheck: "false",
    placeholder: "203.0.113.7:8333", "aria-describedby": "invite-hint",
  });
  const formMsg = h("p", { class: "form-error", role: "alert" });
  const submit = h("button", { type: "submit", class: "btn btn-green" }, icon("user-plus"), t("peers.invite"));
  const form = h("form", { class: "form invite-form", novalidate: true },
    h("div", { class: "form-row" },
      h("label", { class: "field grow", for: "invite-addr" },
        h("span", { class: "field-label" }, t("peers.invite.label")), input),
      submit),
    h("p", { class: "field-hint", id: "invite-hint" }, t("peers.invite.hint")),
    formMsg);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    formMsg.textContent = "";
    formMsg.className = "form-error";
    const address = input.value.trim();
    if (!validAddress(address)) {
      input.setAttribute("aria-invalid", "true");
      formMsg.textContent = t("peers.invite.invalid");
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    const ok = await confirmDialog({
      title: t("peers.invite.confirmTitle"),
      body: [t("peers.invite.confirmBody"), h("code", { class: "dialog-code" }, `addnode ${address} add`)],
      ok: t("peers.invite"),
    });
    if (!ok) return;
    submit.disabled = true;
    try {
      await rpc("addnode", [address, "add"]);
      formMsg.className = "form-ok";
      formMsg.textContent = t("peers.invite.sent", { addr: address });
      toast(t("peers.invite.sent", { addr: address }));
      input.value = "";
      // The peer shows up after the handshake: poll a few times quickly.
      for (const ms of [300, 1500, 3000]) setTimeout(() => refresh(), ms);
    } catch (err) {
      formMsg.textContent = errorText(err);
    } finally {
      submit.disabled = false;
    }
  });

  // ----- table ----------------------------------------------------------
  const tbody = h("tbody");
  const table = h("table", { class: "table peers-table" },
    h("thead", {}, h("tr", {},
      h("th", { scope: "col" }, t("peers.col.address")),
      h("th", { scope: "col", title: "user_agent" }, t("peers.col.agent")),
      h("th", { scope: "col", title: "servicesnames" }, t("peers.col.services")),
      h("th", { scope: "col", title: "kind" }, t("peers.col.kind")),
      h("th", { scope: "col", title: "state" }, t("peers.col.state")),
      h("th", { scope: "col", title: "transport_protocol" }, "V1/V2"),
      h("th", { scope: "col", title: "initial_height", class: "num" }, t("peers.col.height")),
      h("th", { scope: "col" }, h("span", { class: "visually-hidden" }, t("peers.col.actions"))))),
    tbody);
  const empty = h("p", { class: "empty", hidden: true }, t("peers.empty"));
  const offline = h("p", { class: "empty", hidden: true }, t("err.unreachable"));

  root.append(
    pageHead("PARTY", "パーティ", t("peers.lead")),
    warn,
    h("div", { class: "peers-top" },
      h("section", { class: "window summary-window", title: t("peers.summary.tip") },
        windowTab("UTREEXO", "ユートレクソ", { tone: "green" }),
        h("p", { class: "summary-line" },
          h("span", { class: "summary-part" }, h("span", { class: "summary-label" }, t("peers.summary.utreexo")), sumUtreexo),
          h("span", { class: "summary-sep", "aria-hidden": "true" }, "/"),
          h("span", { class: "summary-part" }, h("span", { class: "summary-label" }, t("peers.summary.total")), sumTotal)),
        h("p", { class: "note" }, t("peers.summary.note"))),
      h("section", { class: "window invite-window" },
        windowTab("INVITE A FRIEND", "なかまをよぶ", { tip: "addnode <ip:port> add" }),
        form)),
    h("section", { class: "window peers-window" },
      windowTab("MEMBERS", "メンバー", { tip: "getpeerinfo" }),
      h("div", { class: "table-wrap" }, table), empty, offline),
  );

  async function disconnect(peer) {
    const ok = await confirmDialog({
      title: t("peers.disconnect.title"),
      body: [t("peers.disconnect.body", { addr: peer.address }), h("code", { class: "dialog-code" }, `disconnectnode ${peer.address}`)],
      ok: t("peers.disconnect"),
      danger: true,
    });
    if (!ok) return;
    try {
      await rpc("disconnectnode", [peer.address]);
      toast(t("peers.disconnect.done", { addr: peer.address }));
      refresh();
    } catch (err) {
      toast(errorText(err), { error: true });
    }
  }

  function row(peer) {
    const flags = peerUtreexo(peer);
    return h("tr", { class: [flags.utreexo && "is-highlight"] },
      h("td", { "data-label": t("peers.col.address") },
        h("span", { class: "peer-addr" },
          flags.utreexo ? h("span", { class: "utreexo-mark", title: flags.archive ? "UTREEXO + UTREEXO_ARCHIVE" : "UTREEXO" }, icon("trees")) : null,
          h("span", { class: "mono" }, peer.address))),
      h("td", { "data-label": t("peers.col.agent"), class: "peer-agent" }, peer.user_agent || "—"),
      h("td", { "data-label": t("peers.col.services") }, serviceChips(peer)),
      h("td", { "data-label": t("peers.col.kind"), class: "peer-kind" }, peer.kind || "—"),
      h("td", { "data-label": t("peers.col.state") }, stateChip(peer.state)),
      h("td", { "data-label": "V1/V2" }, h("span", { class: "chip" }, peer.transport_protocol || "?")),
      h("td", { "data-label": t("peers.col.height"), class: "num" }, formatNumber(peer.initial_height)),
      h("td", { class: "actions" },
        h("button", {
          type: "button", class: "icon-btn btn-danger disconnect-btn", onclick: () => disconnect(peer),
          title: `${t("peers.disconnect")} (disconnectnode)`, "aria-label": `${t("peers.disconnect")} ${peer.address}`,
        }, icon("unplug"), h("span", { class: "disconnect-label" }, t("peers.disconnect")))));
  }

  let lastKey = "";
  function render(s) {
    const online = s.status === "online" && s.peersOk;
    offline.hidden = s.status !== "offline";
    if (!online) {
      if (s.status === "offline") {
        tbody.replaceChildren();
        empty.hidden = true;
        lastKey = "";
      }
      return;
    }
    const peers = [...s.peers].sort((a, b) =>
      Number(peerUtreexo(b).utreexo) - Number(peerUtreexo(a).utreexo) || (a.id ?? 0) - (b.id ?? 0));
    const u = countUtreexo(peers);
    sumUtreexo.textContent = formatNumber(u);
    sumTotal.textContent = formatNumber(peers.length);
    const warnKey = u < MIN_UTREEXO_PEERS ? `w${u}` : "";
    if (warn.dataset.key !== warnKey) {
      warn.dataset.key = warnKey;
      warn.replaceChildren(...(warnKey ? [h("div", { class: "banner", role: "alert" }, icon("triangle-alert"),
        h("div", { class: "banner-text" },
          h("div", { class: "banner-title" }, t("peers.warn.title")),
          h("div", {}, t("dash.stall.fewUtreexo", { n: u, min: MIN_UTREEXO_PEERS }))))] : []));
    }
    // Only rebuild rows when something changed, so buttons keep focus.
    const key = JSON.stringify(peers.map((p) => [p.id, p.address, p.state, p.services, p.kind, p.transport_protocol]));
    if (key === lastKey) return;
    lastKey = key;
    tbody.replaceChildren(...peers.map(row));
    empty.hidden = peers.length > 0;
  }

  const unsub = subscribe(render);
  refresh();
  if (ctx?.query?.has("invite")) setTimeout(() => input.focus(), 50);
  return unsub;
}
