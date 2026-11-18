// WALLET (#/wallet): watch-only descriptors and rescans (design doc 5.4).
// Floresta's wallet is watch-only. Private keys are stopped here, before
// anything is sent to the server.
import { h, icon } from "../dom.js";
import { t } from "../i18n.js";
import { rpc } from "../rpc.js";
import { getState } from "../store.js";
import { confirmDialog, copyButton, errorText, pageHead, toast, windowTab } from "../ui.js";

const B58 = "1-9A-HJ-NP-Za-km-z";
// Extended private keys: xprv, tprv and the SLIP-132 variants (yprv, zprv, uprv, vprv, Yprv, Zprv, Uprv, Vprv).
const EXT_PRIV_RE = new RegExp(`[xtyzuvYZUV]prv[${B58}]{20,}`);
// WIF private keys (51/52 base58 chars starting with 5, K, L, 9 or c) as a whole key expression.
const WIF_RE = new RegExp(`(^|[(,\\]])[5KL9c][${B58}]{50,51}(?=$|[),/#])`);
const BARE_PUB_RE = new RegExp(`^[xt]pub[${B58}]{100,}$`);

/** True if the text looks like it contains a private key. */
export function containsPrivateKey(text) {
  const s = (text || "").trim();
  return EXT_PRIV_RE.test(s) || WIF_RE.test(s);
}

/** A bare xpub/tpub becomes receive + change wpkh descriptors. Returns null for anything else. */
export function descriptorsFromBareKey(text) {
  const s = (text || "").trim();
  if (!BARE_PUB_RE.test(s)) return null;
  return [`wpkh(${s}/0/*)`, `wpkh(${s}/1/*)`];
}

export function middleEllipsis(text, head = 26, tail = 18) {
  return text.length <= head + tail + 1 ? text : `${text.slice(0, head)}…${text.slice(-tail)}`;
}

/** "sh(wpkh(...))" -> "sh(wpkh)" */
export function scriptType(desc) {
  const names = [];
  let rest = desc;
  let m;
  while ((m = /^([a-z_]+)\(/.exec(rest)) && names.length < 3) {
    names.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  return names.length ? names.join("(") + ")".repeat(names.length - 1) : "?";
}

function friendlyError(err) {
  const msg = err?.message || "";
  if (/initial\s*block\s*download|syncing/i.test(msg)) return t("wallet.err.ibd");
  if (/InvalidDescriptor/i.test(msg)) return t("wallet.err.invalid");
  return errorText(err);
}

export function mount(root) {
  let alive = true;

  // ----- list -----------------------------------------------------------
  const list = h("ul", { class: "desc-list" });
  const listStatus = h("p", { class: "loading" }, icon("loader", "icon spinner"), t("common.loading"));
  const count = h("span", { class: "chip is-gold" }, "—");

  async function loadList() {
    try {
      const descs = await rpc("listdescriptors");
      if (!alive) return;
      listStatus.hidden = true;
      count.textContent = String(descs.length);
      if (!descs.length) {
        list.replaceChildren(h("li", { class: "empty" }, t("wallet.empty")));
        return;
      }
      list.replaceChildren(...descs.map((d) => h("li", { class: "desc-item" },
        h("span", { class: "chip is-green desc-type" }, scriptType(d)),
        h("span", { class: "desc-text mono", title: d }, middleEllipsis(d)),
        copyButton(d))));
    } catch (err) {
      if (!alive) return;
      listStatus.hidden = false;
      listStatus.className = "form-error";
      listStatus.textContent = errorText(err);
    }
  }

  // ----- add form -------------------------------------------------------
  const textarea = h("textarea", {
    class: "textarea", id: "desc-input", rows: 3, spellcheck: "false", autocomplete: "off",
    placeholder: "wpkh([fingerprint/84'/1'/0']tpubD…/0/*)", "aria-describedby": "desc-hint",
  });
  const addMsg = h("p", { role: "alert" });
  const addBtn = h("button", { type: "submit", class: "btn btn-green" }, icon("plus"), t("wallet.add.button"));
  const addForm = h("form", { class: "form", novalidate: true },
    h("div", { class: "banner is-info watch-only" }, icon("triangle-alert"),
      h("div", { class: "banner-text" },
        h("div", { class: "banner-title" }, t("wallet.watchOnly.title")),
        h("div", {}, t("wallet.watchOnly.body")))),
    h("label", { class: "field", for: "desc-input" }, h("span", { class: "field-label" }, t("wallet.add.label")), textarea),
    h("p", { class: "field-hint", id: "desc-hint" }, t("wallet.add.hint")),
    h("div", { class: "form-row" }, addBtn),
    addMsg);

  textarea.addEventListener("input", () => {
    if (containsPrivateKey(textarea.value)) showPrivateKeyWarning();
    else if (textarea.getAttribute("aria-invalid")) {
      textarea.removeAttribute("aria-invalid");
      addMsg.textContent = "";
    }
  });

  function showPrivateKeyWarning() {
    // Never keep a private key around: clear it, warn, and send nothing.
    textarea.value = "";
    textarea.setAttribute("aria-invalid", "true");
    addMsg.className = "form-error";
    addMsg.textContent = t("wallet.err.private");
    textarea.focus();
  }

  addForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const text = textarea.value.trim();
    // Keep the private-key warning visible if a key was just removed.
    if (!text && textarea.getAttribute("aria-invalid") === "true") return;
    addMsg.textContent = "";
    if (!text) {
      addMsg.className = "form-error";
      addMsg.textContent = t("wallet.err.empty");
      return;
    }
    if (containsPrivateKey(text)) {
      showPrivateKeyWarning();
      return;
    }
    let descs = descriptorsFromBareKey(text);
    if (!descs) {
      if (!/^[a-z]+\(.+\)(#[a-z0-9]{8})?$/s.test(text)) {
        addMsg.className = "form-error";
        addMsg.textContent = t("wallet.err.shape");
        return;
      }
      descs = [text];
    }
    const ok = await confirmDialog({
      title: t("wallet.add.confirmTitle"),
      body: [descs.length > 1 ? t("wallet.add.confirmBare") : t("wallet.add.confirmBody"),
        ...descs.map((d) => h("code", { class: "dialog-code" }, `loaddescriptor ${d}`))],
      ok: t("wallet.add.button"),
    });
    if (!ok) return;
    addBtn.disabled = true;
    try {
      for (const d of descs) await rpc("loaddescriptor", [d]);
      textarea.value = "";
      addMsg.className = "form-ok";
      addMsg.textContent = t("wallet.add.done");
      toast(t("wallet.add.done"));
      loadList();
    } catch (err) {
      addMsg.className = "form-error";
      addMsg.textContent = friendlyError(err);
    } finally {
      addBtn.disabled = false;
    }
  });

  // ----- rescan form ----------------------------------------------------
  const modeHeight = h("input", { type: "radio", name: "rescan-mode", value: "height", checked: true });
  const modeDate = h("input", { type: "radio", name: "rescan-mode", value: "date" });
  const startHeight = h("input", { class: "input mono", type: "number", min: 0, step: 1, id: "rs-start", value: "0", inputmode: "numeric" });
  const stopHeight = h("input", { class: "input mono", type: "number", min: 0, step: 1, id: "rs-stop", placeholder: t("wallet.rescan.tip") });
  const startDate = h("input", { class: "input", type: "date", id: "rs-start-date" });
  const stopDate = h("input", { class: "input", type: "date", id: "rs-stop-date" });
  const confidence = h("select", { class: "select", id: "rs-confidence" },
    ...["high", "medium", "low", "exact"].map((c) => h("option", { value: c, selected: c === "medium" }, t(`wallet.conf.${c}`))));
  const heightFields = h("div", { class: "form-row" },
    h("label", { class: "field grow", for: "rs-start" }, h("span", { class: "field-label" }, t("wallet.rescan.startHeight")), startHeight),
    h("label", { class: "field grow", for: "rs-stop" }, h("span", { class: "field-label" }, t("wallet.rescan.stopHeight")), stopHeight));
  const dateFields = h("div", { class: "form-row", hidden: true },
    h("label", { class: "field grow", for: "rs-start-date" }, h("span", { class: "field-label" }, t("wallet.rescan.startDate")), startDate),
    h("label", { class: "field grow", for: "rs-stop-date" }, h("span", { class: "field-label" }, t("wallet.rescan.stopDate")), stopDate),
    h("label", { class: "field grow", for: "rs-confidence", title: "confidence" }, h("span", { class: "field-label" }, t("wallet.rescan.confidence")), confidence));
  const rescanMsg = h("p", { role: "alert" });
  const rescanBtn = h("button", { type: "submit", class: "btn" }, icon("refresh-cw"), t("wallet.rescan.button"));
  const rescanForm = h("form", { class: "form", novalidate: true },
    h("fieldset", { class: "radio-row plain" },
      h("legend", { class: "field-label" }, t("wallet.rescan.from")),
      h("label", {}, modeHeight, t("wallet.rescan.byHeight")),
      h("label", {}, modeDate, t("wallet.rescan.byDate"))),
    heightFields, dateFields,
    h("p", { class: "field-hint" }, t("wallet.rescan.hint")),
    h("div", { class: "form-row" }, rescanBtn),
    rescanMsg);
  const syncMode = () => {
    const byDate = modeDate.checked;
    heightFields.hidden = byDate;
    dateFields.hidden = !byDate;
  };
  modeHeight.addEventListener("change", syncMode);
  modeDate.addEventListener("change", syncMode);

  rescanForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    rescanMsg.className = "form-error";
    rescanMsg.textContent = "";
    let params;
    let summary;
    if (modeDate.checked) {
      if (!startDate.value) {
        rescanMsg.textContent = t("wallet.rescan.err.date");
        return;
      }
      const start = Math.floor(Date.parse(`${startDate.value}T00:00:00Z`) / 1000);
      const stop = stopDate.value ? Math.floor(Date.parse(`${stopDate.value}T23:59:59Z`) / 1000) : 0;
      if (stop && stop < start) {
        rescanMsg.textContent = t("wallet.rescan.err.order");
        return;
      }
      params = [start, stop, true, confidence.value];
      summary = t("wallet.rescan.summaryDate", { start: startDate.value, stop: stopDate.value || t("wallet.rescan.tipWord"), conf: confidence.value });
    } else {
      const start = Number(startHeight.value || 0);
      const stop = stopHeight.value === "" ? 0 : Number(stopHeight.value);
      if (!Number.isInteger(start) || start < 0 || !Number.isInteger(stop) || stop < 0) {
        rescanMsg.textContent = t("wallet.rescan.err.height");
        return;
      }
      if (stop && stop < start) {
        rescanMsg.textContent = t("wallet.rescan.err.order");
        return;
      }
      const tip = getState().chain?.blocks;
      if (tip !== undefined && start > tip) {
        rescanMsg.textContent = t("wallet.rescan.err.beyond", { tip });
        return;
      }
      params = [start, stop];
      summary = t("wallet.rescan.summaryHeight", { start, stop: stop || t("wallet.rescan.tipWord") });
    }
    const ok = await confirmDialog({
      title: t("wallet.rescan.confirmTitle"),
      body: [summary, h("code", { class: "dialog-code" }, `rescanblockchain ${params.map((p) => JSON.stringify(p)).join(" ")}`)],
      ok: t("wallet.rescan.button"),
    });
    if (!ok) return;
    rescanBtn.disabled = true;
    try {
      await rpc("rescanblockchain", params);
      rescanMsg.className = "form-ok";
      rescanMsg.textContent = t("wallet.rescan.started");
      toast(t("wallet.rescan.started"));
    } catch (err) {
      rescanMsg.textContent = friendlyError(err);
    } finally {
      rescanBtn.disabled = false;
    }
  });

  root.append(
    pageHead("WALLET", "ウォレット", t("wallet.lead")),
    h("div", { class: "stack" },
      h("section", { class: "window" },
        windowTab("DESCRIPTORS", "ディスクリプタ", { tone: "green", tip: "listdescriptors" }),
        h("div", { class: "window-actions" }, count),
        listStatus, list),
      h("div", { class: "grid-2" },
        h("section", { class: "window" }, windowTab("ADD", "ついか", { tip: "loaddescriptor" }), addForm),
        h("section", { class: "window" }, windowTab("RESCAN", "さいスキャン", { tone: "pink", tip: "rescanblockchain" }), rescanForm))),
  );

  loadList();
  return () => {
    alive = false;
  };
}
