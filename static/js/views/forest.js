// FOREST MAP (#/forest): the Utreexo accumulator roots as a forest (design doc 5.3).
//
// getroots returns only the root hashes, not the number of leaves, so the
// trees are drawn the same size: we know how many trees there are, not how
// big each one is.
import { h, icon } from "../dom.js";
import { formatBytes, formatNumber, shortHash } from "../format.js";
import { t } from "../i18n.js";
import { createGirl } from "../characters.js";
import { tree } from "../stage.js";
import { refresh, subscribe } from "../store.js";
import { copyButton, hashView, pageHead, windowTab } from "../ui.js";

const ROOT_BYTES = 32;
const MAINNET_UTXO_BYTES = 10e9; // ~10 GB chainstate, for the comparison sentence

const INK = "#24442F";

function panorama(count) {
  const spacing = 78;
  const width = Math.max(820, count * spacing + 120);
  const svg = h("svg:svg", {
    class: "forest-panorama",
    viewBox: `0 0 ${width} 230`,
    preserveAspectRatio: "xMidYMax meet",
    role: "img",
    "aria-label": t("forest.panorama.aria", { n: count }),
  },
    h("svg:rect", { class: "sky", x: 0, y: 0, width, height: 230 }),
    h("svg:path", {
      class: "hill-back",
      d: `M0 150 Q${width * 0.25} 110 ${width * 0.5} 140 Q${width * 0.75} 170 ${width} 130 L${width} 230 L0 230 Z`,
      stroke: INK, "stroke-width": 3,
    }),
    h("svg:path", { class: "hill-front", d: `M0 196 Q${width / 2} 176 ${width} 196 L${width} 230 L0 230 Z`, stroke: INK, "stroke-width": 3 }));
  const start = (width - (count - 1) * spacing) / 2;
  for (let i = 0; i < count; i += 1) {
    const x = count > 1 ? start + i * spacing : width / 2;
    const g = tree(x, 186, 1.15, i);
    g.setAttribute("data-index", String(i));
    // a little wooden sign with the root number
    g.appendChild(h("svg:rect", { class: "sign", x: x - 15, y: 192, width: 30, height: 20, rx: 5, stroke: INK, "stroke-width": 2.5 }));
    g.appendChild(h("svg:text", { class: "sign-text", x, y: 207, "text-anchor": "middle" }, String(i)));
    svg.appendChild(g);
  }
  if (!count) {
    svg.appendChild(h("svg:text", { class: "sign-text", x: width / 2, y: 120, "text-anchor": "middle" }, "?"));
  }
  return svg;
}

export function mount(root) {
  const bytesEl = h("span", { class: "big-num" }, "—");
  const rootsEl = h("span", { class: "big-num" }, "—");
  const compare = h("p", { class: "forest-compare" });
  const asOf = h("p", { class: "note forest-asof" });
  // Only some florestad versions report the number of leaves (leaf_count).
  const leavesNote = h("p", { class: "note", hidden: true });
  const scene = h("div", { class: "forest-scene" });
  const list = h("ol", { class: "root-list", start: 0 });
  const copyAllSlot = h("span", { class: "window-actions" });
  const status = h("p", { class: "loading" }, icon("loader", "icon spinner"), t("common.loading"));

  const girl = createGirl("happy");
  girl.classList.add("mini-girl");

  root.append(
    pageHead("FOREST MAP", "フォレストマップ", t("forest.lead")),
    h("section", { class: "window forest-hero" },
      windowTab("THIS NODE KEEPS", "このノードがもつもの", { tone: "green", tip: "getroots" }),
      h("div", { class: "hero-grid" },
        h("div", { class: "hero-figure" },
          h("div", { class: "hero-num" }, rootsEl, h("span", { class: "hero-unit" }, t("forest.roots"))),
          h("div", { class: "hero-times", "aria-hidden": "true" }, "× 32 B ="),
          h("div", { class: "hero-num" }, bytesEl)),
        compare),
      asOf, leavesNote),
    h("section", { class: "window forest-window" },
      windowTab("FOREST", "もり"),
      scene,
      h("p", { class: "note" }, icon("triangle-alert", "icon inline-icon"), t("forest.scaleNote"))),
    h("section", { class: "window forest-talk" },
      windowTab("WHAT IS THIS?", "これはなに？", { tone: "pink" }),
      h("div", { class: "talk-row" },
        h("div", { class: "mini-girl-wrap", "aria-hidden": "true" }, girl),
        h("div", { class: "talk-bubble" },
          h("p", {}, t("forest.explain.1")),
          h("p", {}, t("forest.explain.2"))))),
    h("section", { class: "window roots-window" },
      windowTab("ROOTS", "ルート", { tip: "getroots" }),
      copyAllSlot,
      status,
      list),
  );

  function highlight(index, on) {
    const g = scene.querySelector(`.tree[data-index="${index}"]`);
    if (g) g.classList.toggle("is-active", on);
  }

  let lastKey = null;
  function render(s) {
    if (s.status === "offline" && !s.roots) {
      status.hidden = false;
      status.className = "form-error";
      status.textContent = t("err.unreachable");
      return;
    }
    if (!Array.isArray(s.roots)) return;
    const roots = s.roots;
    const key = roots.join(",");
    if (s.chain) {
      asOf.replaceChildren(
        t("forest.asOf", { height: formatNumber(s.chain.blocks) }), " ",
        hashView(s.chain.bestblockhash, { href: `#/block/${s.chain.bestblockhash}`, head: 10, tail: 10 }));
    }
    const leaves = s.chain?.leaf_count;
    leavesNote.hidden = leaves === undefined;
    if (leaves !== undefined) leavesNote.textContent = t("forest.leaves", { n: formatNumber(leaves) });
    if (key === lastKey) return;
    lastKey = key;
    status.hidden = true;

    const bytes = roots.length * ROOT_BYTES;
    rootsEl.textContent = formatNumber(roots.length);
    bytesEl.textContent = `${formatNumber(bytes)} B`;
    const ratio = bytes ? Math.round(MAINNET_UTXO_BYTES / bytes) : 0;
    compare.replaceChildren(
      h("strong", {}, t("forest.compare.lead", { size: formatBytes(bytes) })), " ",
      t("forest.compare.body", { ratio: formatNumber(ratio) }));

    const pano = panorama(roots.length);
    // Keep trees readable on phones: the scene scrolls sideways instead of shrinking.
    pano.style.setProperty("min-width", `${Math.max(320, roots.length * 46)}px`);
    scene.replaceChildren(pano);
    copyAllSlot.replaceChildren(
      h("span", { class: "copy-all" }, t("forest.copyAll"), copyButton(JSON.stringify(roots), { label: t("forest.copyAll") })));
    list.replaceChildren(...roots.map((r, i) => {
      const li = h("li", { class: "root-item", tabindex: 0, "aria-label": t("forest.rootAria", { i, hash: shortHash(r) }) },
        h("span", { class: "root-index", "aria-hidden": "true" }, icon("trees"), h("span", { class: "mono" }, `#${i}`)),
        h("span", { class: "root-hash mono" }, r),
        copyButton(r, { label: t("forest.copyRoot", { i }) }));
      li.addEventListener("mouseenter", () => highlight(i, true));
      li.addEventListener("mouseleave", () => highlight(i, false));
      li.addEventListener("focusin", () => highlight(i, true));
      li.addEventListener("focusout", () => highlight(i, false));
      return li;
    }));
    if (!roots.length) list.replaceChildren(h("li", { class: "empty" }, t("forest.empty")));
  }

  const unsub = subscribe(render);
  refresh();
  return unsub;
}
