var jouleDom = (function () {
  const api = acquireVsCodeApi();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  }

  function post(kind, extra) {
    api.postMessage(Object.assign({ kind }, extra || {}));
  }

  function button(className, label, onClick) {
    const node = el("button", className, label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  function mascot() {
    const node = el("span", "quanta");
    node.setAttribute("aria-hidden", "true");
    node.appendChild(el("i"));
    node.appendChild(el("i"));
    return node;
  }

  function wordmark(version) {
    const box = el("span", "wordmark");
    box.appendChild(el("span", "wordmark-text", "joule"));
    box.appendChild(mascot());
    if (version) { box.appendChild(el("span", "wordmark-version", version)); }
    return box;
  }

  function shortPath(full) {
    const text = String(full || "");
    if (text.length <= 44) { return text; }
    return "..." + text.slice(text.length - 41);
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICON_PATHS = {
    plus: ["M8 3.5v9", "M3.5 8h9"],
    shield: ["M8 1.5l4.5 1.8v3.2c0 2.9-1.9 4.8-4.5 5.9-2.6-1.1-4.5-3-4.5-5.9V3.3z"],
    model: ["M5 5h6v6H5z", "M8 2v3", "M8 11v3", "M2 8h3", "M11 8h3"],
    monitor: ["M2.5 3.5h11v7h-11z", "M8 10.5V13", "M5.5 13h5"],
    send: ["M8 12.5v-9", "M4.5 7L8 3.5 11.5 7"],
    stop: ["M5.5 5.5h5v5h-5z"],
    x: ["M5 5l6 6", "M11 5l-6 6"],
  };

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("class", "icon icon-" + name);
    svg.setAttribute("aria-hidden", "true");
    for (const d of ICON_PATHS[name] || []) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    return svg;
  }

  function hiddenText(text) {
    return el("span", "visually-hidden", text);
  }

  return { el, post, button, mascot, wordmark, shortPath, icon, hiddenText };
})();
