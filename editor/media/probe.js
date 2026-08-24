(function () {
  const api = acquireVsCodeApi();
  window.acquireVsCodeApi = function () { return api; };

  function matching(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector || "*"));
  }

  function apply(msg, found, reply) {
    if (msg.op === "read") {
      reply.texts = found.map(function (node) { return node.textContent; });
      reply.values = found.map(function (node) {
        return typeof node.value === "string" ? node.value : "";
      });
      return;
    }
    const target = found[msg.index || 0];
    if (!target) {
      reply.ok = false;
      reply.detail = "the panel shows nothing matching " + msg.selector;
      return;
    }
    if (msg.op === "click") {
      target.click();
      return;
    }
    if (msg.op === "scroll") {
      target.scrollIntoView({ block: msg.block || "center" });
      return;
    }
    if (msg.op === "html") {
      reply.texts = found.map(function (node) { return node.outerHTML; });
      return;
    }
    if (msg.op === "measure") {
      reply.texts = found.map(function (node) {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return JSON.stringify({
          font: parseFloat(style.fontSize),
          line: parseFloat(style.lineHeight),
          left: box.left,
          width: box.width,
          height: box.height,
        });
      });
      return;
    }
    if (msg.op === "choose") {
      target.value = msg.value;
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (msg.op === "fill") {
      target.value = msg.text;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new KeyboardEvent("keydown", { key: msg.key || "Enter", bubbles: true }));
      return;
    }
    reply.ok = false;
    reply.detail = "unknown probe op " + msg.op;
  }

  let announced = 0;
  let announcing = null;

  function hello() {
    announced += 1;
    api.postMessage({ kind: "probe.result", id: "probe-hello", ok: true, found: 0, texts: [], detail: "the probe is running in the webview" });
    if (announced > 480 && announcing !== null) {
      clearInterval(announcing);
      announcing = null;
    }
  }

  announcing = setInterval(hello, 250);

  window.addEventListener("message", function (event) {
    const msg = event.data;
    if (!msg || msg.kind !== "probe") { return; }
    if (announcing !== null) {
      clearInterval(announcing);
      announcing = null;
    }
    const reply = { kind: "probe.result", id: msg.id, ok: true, found: 0, texts: [], detail: "" };
    try {
      const found = matching(msg.selector);
      reply.found = found.length;
      apply(msg, found, reply);
    } catch (e) {
      reply.ok = false;
      reply.detail = String(e && e.message ? e.message : e);
    }
    api.postMessage(reply);
  });

  hello();
})();
