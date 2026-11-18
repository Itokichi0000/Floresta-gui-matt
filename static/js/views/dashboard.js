// Home (#/): forest stage + dialogue, STATUS and PARTY windows (design doc 5.1).
import { h, icon } from "../dom.js";
import { formatBytes, formatDuration, formatNumber, formatPercent, shortHash, timeAgo } from "../format.js";
import { t } from "../i18n.js";
import { countUtreexo, isSyncing, MIN_UTREEXO_PEERS, nodeSituation, peerUtreexo } from "../node.js";
import { createStage } from "../stage.js";
import { refresh, subscribe } from "../store.js";
import { windowTab } from "../ui.js";

function stat(iconName, labelKey, tipKey) {
  const value = h("div", { class: "stat-value" }, "—");
  const sub = h("div", { class: "stat-sub" });
  const label = h("div", { class: "stat-label" }, icon(iconName), h("span", {}, t(labelKey)));
  const el = h("div", { class: "stat", title: t(tipKey) }, label, value, sub);
  return { el, value, sub };
}

function agentInitial(agent) {
  const name = (agent || "").replace(/^\/+/, "");
  return (name[0] || "?").toUpperCase();
}

function agentName(agent) {
  const m = /^\/?([^/]+)\/?/.exec(agent || "");
  return m ? m[1] : agent || "?";
}

export function mount(root) {
  const stage = createStage();

  // ----- dialogue window -------------------------------------------------
  const lineEl = h("p", { class: "dialogue-text" });
  const choicesEl = h("div", { class: "dialogue-choices" });
  const dialogue = h("section", { class: "dialogue", "aria-live": "polite" },
    h("div", { class: "nameplate" }, t("char.girl.name")),
    lineEl,
    choicesEl,
    h("span", { class: "dialogue-next", "aria-hidden": "true" }, "▼"));

  const banner = h("div", { class: "banner-slot" });

  // ----- STATUS window ---------------------------------------------------
  const lvValue = h("span", { class: "lv-value" }, "—");
  const syncBadge = h("span", { class: "badge" });
  const expFill = h("div", { class: "exp-fill" });
  const expLabel = h("div", { class: "exp-label" }, "—");
  const nextEl = h("span", { class: "exp-next-value mono" }, "—");
  const sHeaders = stat("box", "dash.headers", "dash.headers.tip");
  const sUptime = stat("clock", "dash.uptime", "dash.uptime.tip");
  const sMemory = stat("memory-stick", "dash.memory", "dash.memory.tip");
  const sDisk = stat("hard-drive", "dash.disk", "dash.disk.tip");
  const latestLink = h("a", { class: "latest-hash mono", href: "#/block" }, "—");
  const latestAgo = h("span", { class: "latest-ago" });

  const statusWin = h("section", { class: "window status-window" },
    windowTab("STATUS", "ステータス"),
    h("div", { class: "lv-row" },
      h("div", { class: "lv", title: t("dash.lv.tip") }, h("span", { class: "lv-label" }, "Lv."), lvValue),
      syncBadge),
    h("div", { class: "exp-block" },
      h("div", { class: "exp-head" },
        h("span", { class: "exp-title", title: t("dash.exp.tip") }, "SYNC EXP"),
        h("span", { class: "exp-next", title: t("dash.next.tip") }, "NEXT → ", nextEl)),
      h("div", { class: "exp", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": t("dash.exp.tip") }, expFill, expLabel)),
    h("div", { class: "stats" }, sHeaders.el, sUptime.el, sMemory.el, sDisk.el),
    h("div", { class: "latest", title: t("dash.latest.tip") },
      h("span", { class: "latest-label" }, icon("box"), t("dash.latest")),
      latestLink, latestAgo),
  );

  // ----- PARTY window ----------------------------------------------------
  const partyCount = h("span", { class: "party-count mono" }, "—");
  const partyUtreexo = h("span", { class: "chip is-green" });
  const partyList = h("ul", { class: "party-list" });
  const partyWin = h("section", { class: "window party-window" },
    windowTab("PARTY", "パーティ", { tone: "green", tip: t("dash.party.tip") }),
    h("div", { class: "party-summary" },
      partyCount, h("span", { class: "party-members" }, t("dash.party.members")), partyUtreexo),
    partyList,
    h("div", { class: "party-actions" },
      h("a", { class: "btn btn-small btn-ghost", href: "#/peers" }, t("dash.party.view"), icon("chevron-right")),
      h("a", { class: "btn btn-small btn-green", href: "#/peers?invite", title: "addnode" }, icon("user-plus"), t("peers.invite"))),
  );

  root.append(banner, h("div", { class: "home-top" }, stage.el, dialogue), h("div", { class: "grid-2 home-windows" }, statusWin, partyWin));

  // ----- rendering -------------------------------------------------------
  let lastDialogueKey = "";

  function choice(labelKey, href, onClick) {
    const attrs = { class: "choice" };
    if (href) return h("a", { ...attrs, href }, "▶ ", t(labelKey));
    return h("button", { ...attrs, type: "button", onclick: onClick }, "▶ ", t(labelKey));
  }

  function renderDialogue(s, sit) {
    const chain = s.chain;
    const vars = {
      height: chain ? formatNumber(chain.blocks) : "—",
      remaining: chain ? formatNumber(Math.max(0, chain.headers - chain.blocks)) : "—",
      n: sit.utreexo ?? 0,
    };
    const key = `${sit.reason}|${vars.height}|${vars.remaining}|${vars.n}`;
    if (key === lastDialogueKey) return;
    lastDialogueKey = key;
    lineEl.textContent = t(`talk.${sit.reason}`, vars);
    const choices = {
      loading: [],
      offline: [choice("talk.choice.retry", null, () => refresh())],
      auth: [choice("talk.choice.retry", null, () => refresh())],
      few_utreexo: [choice("talk.choice.party", "#/peers"), choice("talk.choice.invite", "#/peers?invite")],
      stalled: [choice("talk.choice.party", "#/peers"), choice("talk.choice.blocks", "#/block")],
      syncing: [choice("talk.choice.forest", "#/forest"), choice("talk.choice.party", "#/peers")],
      synced: [choice("talk.choice.forest", "#/forest"), choice("talk.choice.latest", chain ? `#/block/${chain.bestblockhash}` : "#/block")],
    }[sit.reason] || [];
    choicesEl.replaceChildren(...choices);
  }

  function renderBanner(s, sit) {
    let node = null;
    if (sit.reason === "offline" || sit.reason === "auth") {
      node = h("div", { class: "banner is-danger", role: "alert" }, icon("unplug"),
        h("div", { class: "banner-text" },
          h("div", { class: "banner-title" }, t("dash.offline.title")),
          h("div", {}, sit.reason === "auth" ? t("err.auth") : t("dash.offline.body"))));
    } else if (sit.reason === "few_utreexo" || sit.reason === "stalled") {
      const why = sit.reason === "few_utreexo"
        ? t("dash.stall.fewUtreexo", { n: sit.utreexo, min: MIN_UTREEXO_PEERS })
        : t("dash.stall.noProgress");
      node = h("div", { class: "banner", role: "alert" }, icon("triangle-alert"),
        h("div", { class: "banner-text" }, h("div", { class: "banner-title" }, t("dash.stall.title")), h("div", {}, why)),
        h("a", { class: "btn btn-small", href: "#/peers" }, t("talk.choice.party"), icon("chevron-right")));
    }
    const key = node ? `${sit.reason}|${sit.utreexo}` : "";
    if (banner.dataset.key !== key) {
      banner.dataset.key = key;
      banner.replaceChildren(...(node ? [node] : []));
    }
  }

  function renderStatus(s) {
    const c = s.chain;
    statusWin.classList.toggle("is-stale", s.status === "offline");
    if (!c) return;
    lvValue.textContent = formatNumber(c.blocks);
    const syncing = isSyncing(c);
    syncBadge.className = syncing ? "badge" : "badge is-green";
    syncBadge.replaceChildren(syncing ? t("dash.syncing") : t("dash.synced"),
      h("span", { class: "kana", lang: "ja" }, syncing ? "同期中" : "最新"));
    const pct = Math.max(0, Math.min(1, c.verificationprogress ?? 0));
    expFill.style.setProperty("--pct", `${(pct * 100).toFixed(3)}%`);
    if (pct >= 1) expFill.setAttribute("data-full", "");
    else expFill.removeAttribute("data-full");
    expLabel.textContent = formatPercent(pct);
    expLabel.parentElement.setAttribute("aria-valuenow", (pct * 100).toFixed(2));
    nextEl.textContent = t("dash.next.blocks", { n: formatNumber(Math.max(0, c.headers - c.blocks)) });
    sHeaders.value.textContent = formatNumber(c.headers);
    sHeaders.sub.textContent = t("dash.headers.sub", { n: formatNumber(c.blocks) });
    sUptime.value.textContent = s.uptime === null ? "—" : formatDuration(s.uptime);
    const used = s.memory?.used;
    sMemory.value.textContent = !used ? t("dash.memory.na") : formatBytes(used);
    sMemory.sub.textContent = !used ? t("dash.memory.naSub") : "locked.used";
    sDisk.value.textContent = c.size_on_disk === undefined ? "—" : formatBytes(c.size_on_disk);
    sDisk.sub.textContent = "size_on_disk";
    latestLink.textContent = shortHash(c.bestblockhash, 10, 10);
    latestLink.href = `#/block/${c.bestblockhash}`;
    latestLink.title = c.bestblockhash;
    latestAgo.textContent = c.time ? timeAgo(c.time) : "";
  }

  function renderParty(s) {
    partyWin.classList.toggle("is-stale", s.status === "offline");
    if (!s.peersOk && s.status !== "online") return;
    const peers = s.peers || [];
    partyCount.textContent = formatNumber(peers.length);
    const u = countUtreexo(peers);
    partyUtreexo.textContent = t("dash.party.utreexo", { n: u });
    partyUtreexo.className = u >= MIN_UTREEXO_PEERS ? "chip is-green" : "chip is-pink";
    const sorted = [...peers].sort((a, b) => Number(peerUtreexo(b).utreexo) - Number(peerUtreexo(a).utreexo));
    const items = sorted.slice(0, 6).map((p) => {
      const flags = peerUtreexo(p);
      return h("li", { class: ["party-member", flags.utreexo && "is-utreexo"] },
        h("span", { class: "avatar", "aria-hidden": "true" }, agentInitial(p.user_agent)),
        h("span", { class: "member-text" },
          h("span", { class: "member-name" }, agentName(p.user_agent)),
          h("span", { class: "member-addr mono" }, p.address)),
        flags.utreexo ? h("span", { class: "chip is-green" }, flags.archive ? "Utreexo ★" : "Utreexo") : null);
    });
    if (!peers.length) items.push(h("li", { class: "empty" }, t("dash.party.empty")));
    if (peers.length > 6) items.push(h("li", { class: "party-more" }, t("dash.party.more", { n: peers.length - 6 })));
    partyList.replaceChildren(...items);
  }

  function render(s) {
    const sit = nodeSituation(s);
    stage.update({
      mood: sit.mood,
      roots: s.status === "online" && Array.isArray(s.roots) ? s.roots.length : s.roots?.length ?? 0,
      bittyLine: t(`bitty.${sit.reason}`),
      captionText: Array.isArray(s.roots) ? t("dash.stage.caption", { n: s.roots.length }) : "",
    });
    renderDialogue(s, sit);
    renderBanner(s, sit);
    renderStatus(s);
    renderParty(s);
  }

  let last = null;
  const unsub = subscribe((s) => {
    last = s;
    render(s);
  });
  // Re-render "12 minutes ago" between polls.
  const tick = setInterval(() => last && last.chain && (latestAgo.textContent = timeAgo(last.chain.time)), 30_000);
  return () => {
    unsub();
    clearInterval(tick);
  };
}
