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

  return { el, post, button, mascot, wordmark, shortPath };
})();
