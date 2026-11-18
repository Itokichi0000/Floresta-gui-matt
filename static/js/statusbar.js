// The always-visible status bar: network, Lv. (height), connection.
import { chainName, formatNumber } from "./format.js";
import { onLangChange, t } from "./i18n.js";
import { subscribe } from "./store.js";

export function startStatusBar() {
  const net = document.getElementById("sb-network");
  const height = document.getElementById("sb-height");
  const conn = document.getElementById("sb-conn");
  const connText = conn.querySelector(".conn-text");

  const render = (s) => {
    net.textContent = s.chain ? chainName(s.chain.chain) : "—";
    height.textContent = s.chain ? formatNumber(s.chain.blocks) : "—";
    conn.dataset.state = s.status;
    const key = s.status === "online" ? "conn.online" : s.status === "offline" ? "conn.offline" : "conn.unknown";
    connText.dataset.i18n = key;
    connText.textContent = t(key);
    conn.title = s.status === "offline" && s.error ? s.error.message : "";
  };
  let last = null;
  subscribe((s) => {
    last = s;
    render(s);
  });
  onLangChange(() => last && render(last));
}
