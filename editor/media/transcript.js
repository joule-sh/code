var jouleTranscript = (function () {
  const { el, post, button } = jouleDom;

  const PENDING_NOTE = "nothing runs until you answer. whoever answers first, here or in a terminal on the same "
    + "session, is the one that decides, and the ask clears everywhere.";

  const opened = new Set();

  function whereLine(where) {
    if (!where || !where.root) { return "this runs where the files are, not in the editor."; }
    if (where.remote) {
      return "runs in " + where.root + " on " + where.host + ", the machine this window is connected to.";
    }
    return "runs in " + where.root + " on this machine, not in the editor.";
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

  function ansiInto(box, text) {
    for (const segment of ansiSegmentsJs(text)) {
      if (segment.cls === "") {
        box.appendChild(document.createTextNode(segment.text));
        continue;
      }
      box.appendChild(el("span", segment.cls, segment.text));
    }
    return box;
  }

  function codeNode(text) {
    const box = el("pre", "tool-output tool-code");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const row = el("span", "code-line");
      row.appendChild(el("span", "code-num", i + 1));
      row.appendChild(el("span", "code-text", lines[i]));
      box.appendChild(row);
    }
    return box;
  }

  function outputNode(item, text) {
    if (item.tool === "read") { return codeNode(text); }
    return ansiInto(el("pre", "tool-output"), text);
  }

  function factOf(item) {
    return toolFactJs(item.tool, item.args, {
      ok: item.status === "ok",
      running: item.status === "running",
      output: item.output,
      truncated: item.truncated,
    });
  }

  function toggle(item, box) {
    if (opened.has(item.callId)) { opened.delete(item.callId); } else { opened.add(item.callId); }
    box.replaceWith(toolNode(item));
  }

  function toolHead(item, fact, expandable, open) {
    const head = el(expandable ? "button" : "div", "tool-head");
    const caret = el("span", "tool-caret", expandable ? (open ? "▾" : "▸") : "");
    caret.setAttribute("aria-hidden", "true");
    head.appendChild(caret);
    head.appendChild(el("span", "tool-name", item.tool));
    const target = el("span", "tool-target", fact.target);
    target.title = fact.target;
    head.appendChild(target);
    head.appendChild(el("span", "tool-meta", fact.meta));
    if (!expandable) { return head; }
    head.type = "button";
    head.setAttribute("aria-expanded", open ? "true" : "false");
    return head;
  }

  function toolNode(item) {
    const fact = factOf(item);
    const plan = planToolOutputCollapseJs(fact.body);
    const open = opened.has(item.callId);
    const expandable = plan.hidden > 0;
    const box = el("div", "item tool tool-" + item.status);
    const head = toolHead(item, fact, expandable, open);
    if (expandable) { head.addEventListener("click", () => toggle(item, box)); }
    box.appendChild(head);
    if (item.diff) { box.appendChild(diffNode(item.diff)); }
    if (fact.body !== "") {
      box.appendChild(outputNode(item, open ? fact.body : plan.head));
    }
    if (expandable) {
      box.appendChild(button("tool-more", open ? "show less" : "+" + plan.hidden + " lines", () => toggle(item, box)));
    }
    return box;
  }

  function approvalChoices(item) {
    const row = el("div", "approval-actions");
    const options = [
      { decision: DECISION_ALLOW, label: "allow" },
      { decision: DECISION_ALWAYS, label: "always allow " + item.tool + " this session" },
      { decision: DECISION_DENY, label: "deny" },
    ];
    for (const opt of options) {
      row.appendChild(button(
        "approval-button approval-" + opt.decision,
        opt.label,
        () => post("answer", { callId: item.callId, decision: opt.decision }),
      ));
    }
    return row;
  }

  function approvalNode(item, where) {
    const card = el("div", "item approval approval-" + item.state);
    const title = el("div", "approval-title");
    title.appendChild(el("span", "approval-tool", item.tool));
    if (item.summary && item.summary !== item.tool) {
      title.appendChild(el("span", "approval-summary", item.summary));
    }
    card.appendChild(title);
    if (item.label && item.label !== item.summary) {
      card.appendChild(el("pre", "approval-detail", item.label));
    }
    if (item.diff) { card.appendChild(diffNode(item.diff)); }
    card.appendChild(el("div", "approval-where", whereLine(where)));

    if (item.state === "pending") {
      card.appendChild(approvalChoices(item));
      card.appendChild(el("div", "approval-note", PENDING_NOTE));
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

  function itemNode(item, where) {
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
    if (item.kind === "approval") { return approvalNode(item, where); }
    if (item.kind === "notice") { return el("div", "item notice notice-" + item.tone, item.text); }
    if (item.kind === "turn-end") {
      if (item.reason === "done") { return el("div", "item turn-end", ""); }
      return el("div", "item turn-end turn-" + item.reason, item.reason);
    }
    return el("div", "item", "");
  }

  function node(state) {
    const list = el("div", "transcript");
    const items = state.conversation ? state.conversation.items : [];
    for (const item of items) { list.appendChild(itemNode(item, state.where)); }
    return list;
  }

  return { node, itemNode, toolNode, diffNode, whereLine, PENDING_NOTE };
})();
