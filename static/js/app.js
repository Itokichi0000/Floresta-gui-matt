// Entry point.
import { startControls } from "./controls.js";
import { applyDom, initI18n, onLangChange } from "./i18n.js";
import { rerender, startRouter } from "./router.js";
import { startStatusBar } from "./statusbar.js";
import { startStore } from "./store.js";

async function main() {
  await initI18n();
  applyDom();
  startControls();
  startStatusBar();
  startStore();
  await startRouter(document.getElementById("main"));
  onLangChange(() => rerender());
}

main().catch((err) => {
  console.error(err);
  document.getElementById("main").textContent = "Failed to start the UI. See the browser console.";
});
