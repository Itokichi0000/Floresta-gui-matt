// BLOCKS (#/block/<height-or-hash>): header first, then the body from peers (design doc 5.5).
import { h, icon } from "../dom.js";
import { formatBytes, formatDateTime, formatNumber, timeAgo } from "../format.js";
import { t } from "../i18n.js";
import { navigate } from "../router.js";
import { rpc } from "../rpc.js";
import { copyButton, errorText, hashView, pageHead, windowTab } from "../ui.js";

const HASH_RE = /^[0-9a-fA-F]{64}$/;
const TX_PAGE = 50;

export function parseBlockQuery(text) {
  const s = (text || "").trim();
  if (/^\d{1,9}$/.test(s)) return { height: Number(s) };
  if (HASH_RE.test(s)) return { hash: s.toLowerCase() };
  return null;
}

function row(label, value, tip) {
  return [h("dt", { title: tip || null }, label), h("dd", {}, value)];
}

export function mount(root, params) {
  let alive = true;
  const query = params[0] ? decodeURIComponent(params[0]) : "";

  // ----- search ---------------------------------------------------------
  const input = h("input", {
    class: "input mono", id: "block-q", name: "q", autocomplete: "off", spellcheck: "false",
    placeholder: t("block.search.placeholder"), value: query,
  });
  const searchErr = h("p", { class: "form-error", role: "alert" });
  const form = h("form", { class: "form-row block-search", role: "search" },
    h("label", { class: "field grow", for: "block-q" }, h("span", { class: "field-label" }, t("block.search.label")), input),
    h("button", { class: "btn", type: "submit" }, icon("search"), t("block.search.go")));
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const q = parseBlockQuery(input.value);
    if (!q) {
      searchErr.textContent = t("block.search.invalid");
      input.setAttribute("aria-invalid", "true");
      return;
    }
    navigate(`/block/${q.height ?? q.hash}`);
  });

  const nav = h("div", { class: "block-nav" });
  const headerBox = h("div", { class: "block-header-body" }, h("p", { class: "loading" }, icon("loader", "icon spinner"), t("common.loading")));
  const bodyBox = h("div", { class: "block-body" });

  root.append(
    pageHead("BLOCKS", "ブロック", t("block.lead")),
    h("section", { class: "window search-window" }, windowTab("SEARCH", "けんさく"), form, searchErr),
    nav,
    h("div", { class: "stack" },
      h("section", { class: "window" }, windowTab("HEADER", "ヘッダー", { tip: "getblockheader" }), headerBox),
      h("section", { class: "window" }, windowTab("CONTENTS", "なかみ", { tone: "green", tip: "getblock (verbosity 1)" }), bodyBox)),
  );

  function showError(box, err) {
    box.replaceChildren(h("p", { class: "form-error" }, errorText(err)));
  }

  function renderNav(header) {
    const prev = header.height > 0
      ? h("a", { class: "btn btn-ghost", href: `#/block/${header.height - 1}`, rel: "prev" }, icon("chevron-left"), `Lv. ${formatNumber(header.height - 1)}`)
      : h("span", { class: "btn btn-ghost", "aria-disabled": "true" }, icon("chevron-left"), t("block.genesis"));
    const next = header.nextblockhash
      ? h("a", { class: "btn btn-ghost", href: `#/block/${header.height + 1}`, rel: "next" }, `Lv. ${formatNumber(header.height + 1)}`, icon("chevron-right"))
      : h("span", { class: "btn btn-ghost", "aria-disabled": "true" }, t("block.tip"), icon("chevron-right"));
    nav.replaceChildren(prev, h("span", { class: "block-nav-title" }, "Lv. ", h("span", { class: "mono" }, formatNumber(header.height))), next);
  }

  function renderHeader(hash, hd) {
    headerBox.replaceChildren(
      h("div", { class: "block-title" },
        h("span", { class: "lv", title: "height" }, h("span", { class: "lv-label" }, "Lv."), h("span", { class: "lv-value" }, formatNumber(hd.height))),
        hd.height === 0 ? h("span", { class: "badge is-pink" }, "GENESIS") : null,
        h("span", { class: "badge" }, t("block.confirmations", { n: formatNumber(hd.confirmations) }))),
      h("dl", { class: "kv block-kv" },
        row(t("block.hash"), hashView(hash, { full: true }), "hash"),
        row(t("block.time"), h("span", {}, formatDateTime(hd.time), " ", h("span", { class: "note" }, `(${timeAgo(hd.time)})`)), "time"),
        row(t("block.mediantime"), formatDateTime(hd.mediantime), "mediantime"),
        row(t("block.prev"), hd.previousblockhash ? hashView(hd.previousblockhash, { href: `#/block/${hd.previousblockhash}`, head: 12, tail: 12 }) : "—", "previousblockhash"),
        row(t("block.next"), hd.nextblockhash ? hashView(hd.nextblockhash, { href: `#/block/${hd.nextblockhash}`, head: 12, tail: 12 }) : "—", "nextblockhash"),
        row(t("block.merkleroot"), hashView(hd.merkleroot, { head: 12, tail: 12 }), "merkleroot"),
        row(t("block.ntx"), h("span", { class: "mono" }, formatNumber(hd.nTx)), "nTx"),
        row(t("block.version"), h("span", { class: "mono" }, `0x${hd.versionHex ?? Number(hd.version).toString(16)}`), "versionHex"),
        row(t("block.bits"), h("span", { class: "mono" }, hd.bits ?? "—"), "bits"),
        row(t("block.nonce"), h("span", { class: "mono" }, formatNumber(hd.nonce)), "nonce"),
        row(t("block.difficulty"), h("span", { class: "mono" }, hd.difficulty === undefined ? "—" : formatNumber(hd.difficulty)), "difficulty"),
        row(t("block.chainwork"), h("span", { class: "mono chainwork" }, hd.chainwork ?? "—"), "chainwork")),
    );
  }

  function renderTxs(txids) {
    const list = h("ol", { class: "tx-list", start: 0 });
    let shown = 0;
    const more = h("button", { type: "button", class: "btn btn-small btn-ghost" });
    const addPage = () => {
      const next = txids.slice(shown, shown + TX_PAGE);
      next.forEach((txid, i) => list.appendChild(h("li", { class: "tx-item" },
        h("span", { class: "tx-index mono" }, `#${shown + i}`),
        h("span", { class: "tx-id mono" }, txid),
        copyButton(txid))));
      shown += next.length;
      more.hidden = shown >= txids.length;
      more.textContent = t("block.tx.more", { n: formatNumber(txids.length - shown) });
    };
    more.addEventListener("click", addPage);
    addPage();
    return h("div", {}, list, more);
  }

  async function loadBody(hash) {
    bodyBox.replaceChildren(
      h("p", { class: "loading", role: "status" }, icon("loader", "icon spinner"), t("block.fetching")),
      h("p", { class: "note" }, t("block.fetching.note")));
    try {
      const b = await rpc("getblock", [hash, 1]);
      if (!alive) return;
      bodyBox.replaceChildren(
        h("div", { class: "stats block-stats" },
          ...[["block.size", formatBytes(b.size), "size"],
            ["block.strippedsize", formatBytes(b.strippedsize), "strippedsize"],
            ["block.weight", `${formatNumber(b.weight)} WU`, "weight"],
            ["block.ntx", formatNumber((b.tx || []).length), "tx"]]
            .map(([k, v, tip]) => h("div", { class: "stat", title: tip },
              h("div", { class: "stat-label" }, t(k)), h("div", { class: "stat-value" }, v)))),
        h("h3", { class: "sub-title" }, t("block.txids")),
        h("p", { class: "note" }, t("block.txids.note")),
        renderTxs(b.tx || []));
    } catch (err) {
      if (!alive) return;
      bodyBox.replaceChildren(
        h("div", { class: "banner is-info" }, icon("triangle-alert"),
          h("div", { class: "banner-text" },
            h("div", { class: "banner-title" }, t("block.fetchFailed")),
            h("div", {}, t("block.fetchFailed.body")),
            h("div", { class: "note" }, errorText(err))),
          h("button", { type: "button", class: "btn btn-small", onclick: () => loadBody(hash) }, icon("refresh-cw"), t("talk.choice.retry"))));
    }
  }

  async function load() {
    let target = query ? parseBlockQuery(query) : null;
    if (query && !target) {
      searchErr.textContent = t("block.search.invalid");
      headerBox.replaceChildren(h("p", { class: "empty" }, t("block.search.invalid")));
      return;
    }
    try {
      let hash;
      if (!target) hash = await rpc("getbestblockhash");
      else if (target.hash) hash = target.hash;
      else hash = await rpc("getblockhash", [target.height]);
      if (!alive) return;
      // The header is local and fast; show it right away.
      const hd = await rpc("getblockheader", [hash, true]);
      if (!alive) return;
      renderNav(hd);
      renderHeader(hash, hd);
      loadBody(hash);
    } catch (err) {
      if (!alive) return;
      showError(headerBox, err);
      bodyBox.replaceChildren();
    }
  }

  load();
  return () => {
    alive = false;
  };
}
