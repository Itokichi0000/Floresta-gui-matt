// The forest stage on the home screen: sky, hills, one tree per Utreexo
// root, the forest girl on the left and bitty on the right.
import { h } from "./dom.js";
import { bittySrc, createGirl, setMood } from "./characters.js";

const INK = "#24442F";

function sceneSvg() {
  return h("svg:svg", {
    class: "stage-scene",
    viewBox: "0 0 1000 340",
    preserveAspectRatio: "xMidYMax slice",
    "aria-hidden": "true",
  },
    h("svg:rect", { class: "sky", x: 0, y: 0, width: 1000, height: 340 }),
    // day: sun + clouds
    h("svg:g", { class: "day-only" },
      h("svg:circle", { cx: 860, cy: 62, r: 34, class: "sun", stroke: INK, "stroke-width": 3 }),
      cloud(150, 70, 1), cloud(560, 46, 0.8), cloud(720, 104, 0.6)),
    // night: moon, stars
    h("svg:g", { class: "night-only" },
      h("svg:path", { class: "moon", d: "M872 40 A34 34 0 1 0 900 98 A26 26 0 1 1 872 40 Z", stroke: INK, "stroke-width": 3 }),
      ...[[90, 40], [210, 90], [320, 30], [430, 74], [520, 26], [640, 66], [760, 30], [960, 140], [40, 140], [600, 120]]
        .map(([x, y], i) => h("svg:circle", { class: "star", cx: x, cy: y, r: i % 3 === 0 ? 3 : 2 }))),
    h("svg:path", {
      class: "hill-back",
      d: "M0 248 Q170 168 360 214 Q560 262 720 196 Q860 140 1000 210 L1000 340 L0 340 Z",
      stroke: INK, "stroke-width": 3, "stroke-linejoin": "round",
    }),
    h("svg:g", { class: "trees" }),
    h("svg:path", {
      class: "hill-front",
      d: "M0 296 Q250 258 520 284 Q780 308 1000 278 L1000 340 L0 340 Z",
      stroke: INK, "stroke-width": 3, "stroke-linejoin": "round",
    }),
    // fireflies (night only, animated in CSS)
    h("svg:g", { class: "night-only fireflies" },
      ...[[300, 240], [460, 200], [640, 230], [380, 280], [700, 270], [540, 250]]
        .map(([x, y], i) => h("svg:circle", { class: `firefly f${i % 3}`, cx: x, cy: y, r: 3.2 }))),
  );
}

function cloud(x, y, s) {
  const d = `M${x} ${y} q${10 * s} ${-26 * s} ${36 * s} ${-16 * s} q${18 * s} ${-22 * s} ${44 * s} ${-4 * s} q${30 * s} ${-2 * s} ${28 * s} ${22 * s} q${4 * s} ${16 * s} ${-16 * s} ${18 * s} l${-84 * s} 0 q${-18 * s} ${-2 * s} ${-8 * s} ${-20 * s} z`;
  return h("svg:path", { class: "cloud", d, stroke: INK, "stroke-width": 3, "stroke-linejoin": "round" });
}

/** One stylised tree. Outline circles first, then fills, so the canopy reads as one shape. */
function tree(x, base, s, index) {
  const parts = [
    [x, base - 46 * s, 22 * s],
    [x - 15 * s, base - 32 * s, 15 * s],
    [x + 15 * s, base - 32 * s, 15 * s],
  ];
  return h("svg:g", { class: `tree sway-${index % 3}`, "data-index": index },
    h("svg:rect", {
      x: x - 4.5 * s, y: base - 24 * s, width: 9 * s, height: 24 * s, rx: 3 * s,
      class: "trunk", stroke: INK, "stroke-width": 3,
    }),
    ...parts.map(([cx, cy, r]) => h("svg:circle", { cx, cy, r: r + 1.5, fill: INK })),
    ...parts.map(([cx, cy, r], i) => h("svg:circle", { cx, cy, r: r - 1.5, class: i === 0 ? "canopy" : "canopy-2" })),
    h("svg:circle", { cx: x - 7 * s, cy: base - 54 * s, r: 4 * s, class: "canopy-shine" }),
  );
}

export function createStage() {
  const scene = sceneSvg();
  const treesG = scene.querySelector(".trees");
  const girl = createGirl("determined");
  const bittyImg = h("img", { src: bittySrc("happy"), alt: "", class: "bitty-img", width: 180, height: 180 });
  const bubble = h("div", { class: "bubble", role: "note" });
  const caption = h("p", { class: "stage-caption" });

  const el = h("div", { class: "stage" },
    scene,
    h("div", { class: "stage-girl" }, girl),
    h("div", { class: "stage-bitty" }, bubble, bittyImg),
    caption,
  );

  let lastTrees = -1;
  let lastMood = null;

  function drawTrees(count) {
    if (count === lastTrees) return;
    lastTrees = count;
    treesG.replaceChildren();
    if (!count) return;
    const left = 290;
    const right = 710;
    const n = Math.min(count, 40);
    const step = n > 1 ? (right - left) / (n - 1) : 0;
    const scale = Math.max(0.55, Math.min(1.35, 9 / Math.max(n, 6)));
    for (let i = 0; i < n; i += 1) {
      const x = n > 1 ? left + i * step : 500;
      const back = i % 2 === 1;
      const base = back ? 238 : 272;
      treesG.appendChild(tree(x, base, back ? scale * 0.82 : scale, i));
    }
  }

  return {
    el,
    /** mood: determined|happy|worried|sleeping; roots: number|null; line: bitty's one-liner. */
    update({ mood, roots, bittyLine, captionText }) {
      if (mood !== lastMood) {
        lastMood = mood;
        setMood(girl, mood);
        el.dataset.mood = mood;
        bittyImg.src = bittySrc(mood);
      }
      drawTrees(roots ?? 0);
      if (bubble.textContent !== bittyLine) bubble.textContent = bittyLine || "";
      bubble.hidden = !bittyLine;
      if (caption.textContent !== captionText) caption.textContent = captionText || "";
    },
  };
}
