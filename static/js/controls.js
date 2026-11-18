// Top-right controls: language switch (and the theme switch).
import { h } from "./dom.js";
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

export function startControls() {
  const slot = document.getElementById("status-actions");
  slot.replaceChildren(languageSwitch());
}
