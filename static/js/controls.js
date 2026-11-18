// Top-right controls: language switch (and the theme switch).
import { h, icon } from "./dom.js";
import { getLang, onLangChange, setLang, t } from "./i18n.js";

function languageSwitch() {
  const buttons = [["en", "EN"], ["ja", "日本語"]].map(([code, label]) =>
    h("button", { type: "button", lang: code, "data-lang": code, onclick: () => setLang(code) }, label));
  const group = h("div", { class: "segmented", role: "group" }, buttons);
  const sync = () => {
    group.setAttribute("aria-label", t("controls.language"));
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.lang === getLang()));
  };
  sync();
  onLangChange(sync);
  return group;
}

const THEME_KEY = "floresta-ui.theme";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function storedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function effectiveTheme() {
  return document.documentElement.dataset.theme || (darkQuery.matches ? "dark" : "light");
}

/** Light = sunny forest, dark = night forest. Follows the OS until the user picks one. */
function themeToggle() {
  const saved = storedTheme();
  if (saved) document.documentElement.dataset.theme = saved;
  const btn = h("button", { type: "button", class: "icon-btn theme-toggle" });
  const sync = () => {
    const dark = effectiveTheme() === "dark";
    btn.replaceChildren(icon(dark ? "sun" : "moon"));
    const label = t(dark ? "controls.toLight" : "controls.toDark");
    btn.title = label;
    btn.setAttribute("aria-label", label);
  };
  btn.addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* keep it for this tab only */
    }
    sync();
  });
  darkQuery.addEventListener("change", sync);
  onLangChange(sync);
  sync();
  return btn;
}

export function startControls() {
  const slot = document.getElementById("status-actions");
  slot.replaceChildren(languageSwitch(), themeToggle());
}
