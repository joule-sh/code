(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");
  let state = null;
  let draft = "";

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  }

  function post(kind, extra) {
    vscode.postMessage(Object.assign({ kind }, extra || {}));
  }

  function diffNode(diff) {
    const box = el("div", "diff");
    const head = el("div", "diff-head");
    head.appendChild(el("span", "diff-path", diff.path));
    if (diff.rows) {
      head.appendChild(el("span", "diff-add", "+" + diff.added));
      head.appendChild(el("span", "diff-del", "-" + diff.removed));
    } else {
      head.appendChild(el("span", "diff-note", "too large to preview"));
    }
    box.appendChild(head);
    if (!diff.rows) { return box; }
    const body = el("pre", "diff-body");
    for (const row of diff.rows) {
      const line = el("span", "diff-row diff-" + row.kind);
      const gutter = el("span", "diff-gutter", row.kind === "add" ? row.b : row.a);
      const mark = row.kind === "add" ? "+" : (row.kind === "del" ? "-" : " ");
      line.appendChild(gutter);
      line.appendChild(el("span", "diff-mark", mark));
      line.appendChild(el("span", "diff-text", row.text));
      body.appendChild(line);
      body.appendChild(document.createTextNode("\n"));
    }
    box.appendChild(body);
    return box;
  }

  function approvalNode(item) {
    const card = el("div", "item approval approval-" + item.state);
    const title = el("div", "approval-title");
    title.appendChild(el("span", "approval-tool", item.tool));
    title.appendChild(el("span", "approval-summary", item.summary));
    card.appendChild(title);
    if (item.label && item.label !== item.summary) {
      card.appendChild(el("pre", "approval-detail", item.label));
    }
    if (item.diff) { card.appendChild(diffNode(item.diff)); }

    if (item.state === "pending") {
      const row = el("div", "approval-actions");
      const options = [
        { decision: "allow", label: "Allow" },
        { decision: "always", label: "Always allow " + item.tool + " this session" },
        { decision: "deny", label: "Deny" },
      ];
      for (const opt of options) {
        const button = el("button", "approval-button approval-" + opt.decision, opt.label);
        button.addEventListener("click", () => post("answer", { callId: item.callId, decision: opt.decision }));
        row.appendChild(button);
      }
      card.appendChild(row);
      return card;
    }

    if (item.state === "submitted") {
      card.appendChild(el("div", "approval-state", "sent: " + item.decision));
      return card;
    }

    const resolved = item.resolvedBy === "here"
      ? "answered here: " + item.decision
      : (item.note || "resolved");
    card.appendChild(el("div", "approval-state approval-" + item.resolvedBy, resolved));
    return card;
  }

  function toolNode(item) {
    const box = el("div", "item tool tool-" + item.status);
    const head = el("div", "tool-head");
    head.appendChild(el("span", "tool-name", item.tool));
    head.appendChild(el("span", "tool-label", item.label));
    box.appendChild(head);
    if (item.diff) { box.appendChild(diffNode(item.diff)); }
    if (item.status !== "running" && item.output) {
      const out = el("pre", "tool-output", item.output + (item.truncated ? "\n(truncated)" : ""));
      box.appendChild(out);
    }
    return box;
  }

  function itemNode(item) {
    if (item.kind === "prompt") {
      const box = el("div", "item prompt");
      box.appendChild(el("pre", "prompt-text", item.text));
      return box;
    }
    if (item.kind === "text") {
      const box = el("div", "item text");
      box.appendChild(el("pre", "text-body", item.text));
      return box;
    }
    if (item.kind === "tool") { return toolNode(item); }
    if (item.kind === "approval") { return approvalNode(item); }
    if (item.kind === "notice") { return el("div", "item notice notice-" + item.tone, item.text); }
    if (item.kind === "turn-end") {
      if (item.reason === "done") { return el("div", "item turn-end", ""); }
      return el("div", "item turn-end turn-" + item.reason, item.reason);
    }
    return el("div", "item", "");
  }

  function headerNode() {
    const head = el("div", "header");
    const session = state.conversation ? state.conversation.session : null;
    const left = el("div", "header-left");
    left.appendChild(el("span", "header-workspace", state.workspaceRoot || "no workspace folder"));
    if (session) {
      left.appendChild(el("span", "header-meta", session.model + " - " + session.mode));
    }
    head.appendChild(left);
    const right = el("div", "header-right");
    right.appendChild(el("span", "badge badge-" + state.state, state.state));
    head.appendChild(right);
    if (state.detail) { head.appendChild(el("div", "header-detail", state.detail)); }
    return head;
  }

  function gateNode() {
    const box = el("div", "gate");
    if (state.daemonAlreadyRunning) {
      box.appendChild(el("p", "gate-text", "A joule daemon is already running for this folder. Attaching joins that session - if someone is driving it from a terminal, you will both be in it."));
    } else {
      box.appendChild(el("p", "gate-text", "No joule daemon is running for this folder. Attaching starts one here, where the files are."));
    }
    const button = el("button", "primary", state.daemonAlreadyRunning ? "Attach to this session" : "Start a session");
    button.addEventListener("click", () => post("attach"));
    box.appendChild(button);
    if (state.state === "failed" && state.detail) {
      box.appendChild(el("pre", "gate-error", state.detail));
    }
    return box;
  }

  function composerNode() {
    const box = el("div", "composer");
    const area = document.createElement("textarea");
    area.className = "composer-input";
    area.rows = 3;
    area.placeholder = "Ask joule to change something in this workspace";
    area.value = draft;
    area.addEventListener("input", () => { draft = area.value; });
    area.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (area.value.trim() !== "") {
          post("submit", { text: area.value });
          draft = "";
          area.value = "";
        }
      }
    });
    box.appendChild(area);
    const row = el("div", "composer-actions");
    const send = el("button", "primary", "Send");
    send.addEventListener("click", () => {
      if (area.value.trim() !== "") {
        post("submit", { text: area.value });
        draft = "";
        area.value = "";
      }
    });
    row.appendChild(send);
    if (state.conversation && state.conversation.turnActive) {
      const cancel = el("button", "secondary", "Cancel turn");
      cancel.addEventListener("click", () => post("cancel"));
      row.appendChild(cancel);
    }
    const detach = el("button", "secondary", "Detach");
    detach.addEventListener("click", () => post("detach"));
    row.appendChild(detach);
    box.appendChild(row);
    return box;
  }

  function render() {
    const atBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 40;
    const active = document.activeElement;
    const focused = active && active.className === "composer-input";
    const caret = focused ? active.selectionStart : -1;

    root.textContent = "";
    if (state === null) { return; }
    root.appendChild(headerNode());

    const attached = state.state === "attached" || state.state === "retrying" || state.state === "starting";
    if (!attached) {
      root.appendChild(gateNode());
      return;
    }

    const list = el("div", "transcript");
    const items = state.conversation ? state.conversation.items : [];
    for (const item of items) { list.appendChild(itemNode(item)); }
    root.appendChild(list);
    root.appendChild(composerNode());

    if (focused) {
      const area = root.querySelector(".composer-input");
      if (area) {
        area.focus();
        if (caret >= 0) { area.setSelectionRange(caret, caret); }
      }
    }
    if (atBottom) { root.scrollTop = root.scrollHeight; }
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.kind !== "state") { return; }
    state = msg.state;
    render();
  });

  post("ready");
})();
