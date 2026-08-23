(function () {
  const api = acquireVsCodeApi();
  window.acquireVsCodeApi = function () { return api; };

  function matching(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector || "*"));
  }

  function apply(msg, found, reply) {
    if (msg.op === "read") {
      reply.texts = found.map(function (node) { return node.textContent; });
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
    if (msg.op === "fill") {
      target.value = msg.text;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new KeyboardEvent("keydown", { key: msg.key || "Enter", bubbles: true }));
      return;
    }
    reply.ok = false;
    reply.detail = "unknown probe op " + msg.op;
  }

  window.addEventListener("message", function (event) {
    const msg = event.data;
    if (!msg || msg.kind !== "probe") { return; }
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
})();
