// Tiny DOM helpers. Everything that shows data from the node goes through
// textContent (never innerHTML): peer user agents and the like are untrusted.

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * h("div", {class: "x", onclick: fn}, "text", child)
 * h("svg:circle", {cx: 3}) creates an SVG element.
 */
export function h(tag, props, ...children) {
  const isSvg = tag.startsWith("svg:");
  const el = isSvg ? document.createElementNS(SVG_NS, tag.slice(4)) : document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") {
      el.setAttribute("class", Array.isArray(value) ? value.filter(Boolean).join(" ") : value);
    } else if (key === "text") {
      el.textContent = String(value);
    } else if (key === "dataset") {
      Object.assign(el.dataset, value);
    } else if (key === "style") {
      for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "value" && !isSvg) {
      el.value = value;
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

/** An icon from the vendored Lucide sprite. */
export function icon(name, cls = "icon") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `vendor/lucide/sprite.svg#${name}`);
  svg.appendChild(use);
  return svg;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
