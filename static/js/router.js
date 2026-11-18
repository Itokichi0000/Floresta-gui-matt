// Hash router: #/, #/peers, #/forest, #/wallet, #/block/<height-or-hash>.
// Reloading the page lands on the same screen.

const ROUTES = [
  { name: "dashboard", pattern: /^\/?$/, load: () => import("./views/placeholder.js") },
  { name: "peers", pattern: /^\/peers\/?$/, load: () => import("./views/placeholder.js") },
  { name: "forest", pattern: /^\/forest\/?$/, load: () => import("./views/placeholder.js") },
  { name: "wallet", pattern: /^\/wallet\/?$/, load: () => import("./views/placeholder.js") },
  { name: "block", pattern: /^\/block(?:\/([^/]+))?\/?$/, load: () => import("./views/placeholder.js") },
];

let outlet = null;
let cleanup = null;
let renderSeq = 0;
const listeners = new Set();

export function parseHash(hash) {
  const path = decodeURIComponent((hash || "").replace(/^#/, "")) || "/";
  for (const route of ROUTES) {
    const m = path.match(route.pattern);
    if (m) return { route, params: m.slice(1).filter((p) => p !== undefined) };
  }
  return { route: ROUTES[0], params: [], notFound: true };
}

export function navigate(path) {
  const target = `#${path.startsWith("/") ? path : `/${path}`}`;
  if (location.hash === target) render();
  else location.hash = target;
}

export function currentRoute() {
  return parseHash(location.hash).route.name;
}

export function onRouteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function highlightNav(name) {
  for (const link of document.querySelectorAll(".nav-link")) {
    if (link.dataset.route === name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

async function render() {
  const seq = ++renderSeq;
  const { route, params } = parseHash(location.hash);
  highlightNav(route.name);
  let mod;
  try {
    mod = await route.load();
  } catch (err) {
    console.error(err);
    mod = await import("./views/placeholder.js");
  }
  if (seq !== renderSeq) return; // a newer navigation won
  if (typeof cleanup === "function") {
    try {
      cleanup();
    } catch (err) {
      console.error(err);
    }
  }
  cleanup = null;
  outlet.replaceChildren();
  outlet.dataset.view = route.name;
  cleanup = mod.mount(outlet, params, { route: route.name }) || null;
  for (const fn of listeners) fn(route.name);
}

export function rerender() {
  return render();
}

export function startRouter(el) {
  outlet = el;
  window.addEventListener("hashchange", () => {
    render().then(() => {
      outlet.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    });
  });
  return render();
}
