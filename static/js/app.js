// Entry point.
import { applyDom, initI18n } from "./i18n.js";
import { startRouter } from "./router.js";

async function main() {
  await initI18n();
  applyDom();
  await startRouter(document.getElementById("main"));
}

main().catch((err) => {
  console.error(err);
  document.getElementById("main").textContent = "Failed to start the UI. See the browser console.";
});
