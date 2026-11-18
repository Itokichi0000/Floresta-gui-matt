// Small UI pieces shared by the views: toasts, confirm dialog, copy buttons.
import { h, icon } from "./dom.js";
import { t } from "./i18n.js";
import { shortHash } from "./format.js";

export function toast(message, { error = false, ms = 3500 } = {}) {
  const box = document.getElementById("toasts");
  const el = h("div", { class: ["toast", error && "is-error"] }, message);
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/** Resolves true when the user presses OK. Uses the <dialog> in index.html. */
export function confirmDialog({ title, body, ok = t("common.ok"), danger = false }) {
  const dialog = document.getElementById("confirm-dialog");
  dialog.querySelector("#confirm-title").textContent = title;
  const bodyEl = dialog.querySelector("#confirm-body");
  bodyEl.replaceChildren(...(Array.isArray(body) ? body : [body]).map((b) => (b instanceof Node ? b : document.createTextNode(String(b)))));
  const okBtn = dialog.querySelector("#confirm-ok");
  okBtn.textContent = ok;
  okBtn.className = danger ? "btn btn-danger" : "btn";
  dialog.returnValue = "";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
    dialog.showModal();
    okBtn.focus();
  });
}

async function writeClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // http://<lan-ip> is not a secure context: fall back to a hidden textarea.
  const ta = h("textarea", { class: "visually-hidden", readonly: true });
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("copy failed");
}

export function copyButton(text, { label = t("common.copy"), small = true } = {}) {
  const btn = h("button", {
    type: "button",
    class: ["icon-btn", small && "is-small"],
    title: label,
    "aria-label": label,
  }, icon("copy"));
  btn.addEventListener("click", async () => {
    try {
      await writeClipboard(text);
      btn.classList.add("is-done");
      btn.replaceChildren(icon("check"));
      toast(t("common.copied"));
      setTimeout(() => {
        btn.classList.remove("is-done");
        btn.replaceChildren(icon("copy"));
      }, 1500);
    } catch {
      toast(t("common.copyFailed"), { error: true });
    }
  });
  return btn;
}

/** A hash shown shortened (or in full) with a copy button and optional link. */
export function hashView(hash, { href = null, full = false, head = 8, tail = 8, copy = true } = {}) {
  const text = full ? hash : shortHash(hash, head, tail);
  const inner = href
    ? h("a", { href, class: ["hash-text", full && "is-full"], title: hash }, text)
    : h("span", { class: ["hash-text", full && "is-full"], title: hash }, text);
  return h("span", { class: "hash" }, inner, copy && hash ? copyButton(hash) : null);
}

/** "SYNC EXP" style heading for a window: big English + small kana. */
export function windowTab(title, kana, { tone = null, tip = null } = {}) {
  return h("h2", { class: ["window-tab", tone && `is-${tone}`], title: tip },
    h("span", {}, title), kana ? h("span", { class: "kana", lang: "ja" }, kana) : null);
}

export function pageHead(title, kana, lead = null) {
  return h("header", { class: "page-head" },
    h("h1", { class: "page-title" }, title, kana ? h("span", { class: "kana", lang: "ja" }, kana) : null),
    lead ? h("p", { class: "page-lead" }, lead) : null);
}

export function errorText(err) {
  if (!err) return "";
  if (err.kind === "node_unreachable" || err.kind === "ui_unreachable") return t("err.unreachable");
  if (err.kind === "auth_failed") return t("err.auth");
  if (err.kind === "timeout") return t("err.timeout");
  if (err.kind === "method_not_allowed") return t("err.notAllowed");
  return err.message || String(err);
}
