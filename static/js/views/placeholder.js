import { h } from "../dom.js";
import { t } from "../i18n.js";

export function mount(root, _params, ctx) {
  root.append(
    h("section", { class: "window placeholder" },
      h("h2", { class: "window-tab" }, h("span", { text: (ctx?.route || "screen").toUpperCase() })),
      h("p", { text: t("placeholder.body") }),
    ),
  );
}
