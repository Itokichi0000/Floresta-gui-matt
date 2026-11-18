// Minimal i18n: flat JSON dictionaries in static/i18n/<lang>.json.
// English is the default and the fallback for missing keys.

const SUPPORTED = ["en", "ja"];
const STORAGE_KEY = "floresta-ui.lang";
const dicts = {};
const listeners = new Set();
let lang = "en";

async function load(code) {
  if (dicts[code]) return;
  const res = await fetch(`i18n/${code}.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`cannot load i18n/${code}.json`);
  dicts[code] = await res.json();
}

function saved() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function initI18n() {
  await load("en");
  const wanted = saved();
  if (wanted && SUPPORTED.includes(wanted) && wanted !== "en") {
    try {
      await load(wanted);
      lang = wanted;
    } catch {
      lang = "en";
    }
  }
  document.documentElement.lang = lang;
}

export function getLang() {
  return lang;
}

export function supportedLangs() {
  return SUPPORTED.filter((code) => code === "en" || code in dicts || true);
}

export async function setLang(code) {
  if (!SUPPORTED.includes(code) || code === lang) return;
  await load(code);
  lang = code;
  document.documentElement.lang = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* private mode: keep the choice for this tab only */
  }
  applyDom();
  for (const fn of listeners) fn(code);
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** t("dash.uptime", {n: 3}) — replaces {n} placeholders. */
export function t(key, vars) {
  let text = dicts[lang]?.[key] ?? dicts.en?.[key] ?? key;
  if (vars) {
    text = text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
  }
  return text;
}

/** Translate static markup: data-i18n (text), data-i18n-title, data-i18n-aria, data-i18n-placeholder. */
export function applyDom(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    el.title = t(el.dataset.i18nTitle);
  }
  for (const el of root.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
}
