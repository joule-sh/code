var jouleTranscript = (function () {
  const { el, post, button } = jouleDom;

  const PENDING_NOTE = "nothing runs until you answer. whoever answers first, here or in a terminal on the same "
    + "session, is the one that decides, and the ask clears everywhere.";

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
    title.appendChild(el("span", "approval-summary", item.summary));
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

  function toolNode(item) {
    const box = el("div", "item tool tool-" + item.status);
    const head = el("div", "tool-head");
    head.appendChild(el("span", "tool-name", item.tool));
    head.appendChild(el("span", "tool-label", item.label));
    box.appendChild(head);
    if (item.diff) { box.appendChild(diffNode(item.diff)); }
    if (item.status !== "running" && item.output) {
      box.appendChild(el("pre", "tool-output", item.output + (item.truncated ? "\n(truncated)" : "")));
    }
    return box;
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

  return { node, itemNode, diffNode, whereLine, PENDING_NOTE };
})();
