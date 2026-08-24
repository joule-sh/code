var jouleComposer = (function () {
  const { el, post, button } = jouleDom;

  const PLACEHOLDER = "describe a change, or paste an error";
  const NO_MODE_YET = "the session has not said what may run yet";

  let draft = "";

  function sessionOf(state) {
    return state.conversation ? state.conversation.session : null;
  }

  function send(area) {
    if (area.value.trim() === "") { return; }
    post("submit", { text: area.value });
    draft = "";
    area.value = "";
  }

  function input() {
    const area = document.createElement("textarea");
    area.className = "composer-input";
    area.rows = 3;
    area.placeholder = PLACEHOLDER;
    area.value = draft;
    area.addEventListener("input", () => { draft = area.value; });
    area.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send(area);
      }
    });
    return area;
  }

  function modeChip(session) {
    const select = el("select", "chip mode-chip");
    const current = session === null ? "" : session.mode;
    const known = [];
    for (const entry of APPROVAL_MODES) { known.push(entry.mode); }
    if (current !== "" && known.indexOf(current) < 0) { known.push(current); }
    for (const mode of known) {
      const option = el("option", "", mode);
      option.value = mode;
      select.appendChild(option);
    }
    select.value = current;
    select.disabled = session === null;
    select.title = "what may run without being asked. the same thing /mode sets in a terminal.";
    select.addEventListener("change", () => post("mode", { mode: select.value }));
    return select;
  }

  function modelChip(session) {
    const label = session === null || !session.model ? "model" : session.model;
    const chip = button("chip model-chip", label, () => post("model"));
    chip.disabled = session === null;
    chip.title = "the model this session drives. the same thing /model sets in a terminal.";
    return chip;
  }

  function sendChip(state, area) {
    if (state.conversation && state.conversation.turnActive) {
      const stop = button("chip composer-send composer-stop", "stop", () => post("cancel"));
      stop.title = "stop the turn that is running";
      return stop;
    }
    const chip = button("chip composer-send", "send", () => send(area));
    chip.title = "enter sends, shift-enter starts a new line";
    return chip;
  }

  function whereText(where) {
    if (!where || !where.root) { return "tools run where the files are, never in the editor"; }
    if (where.remote) {
      return "tools run on " + where.host + ", where the files are: " + where.root + " - never in the editor";
    }
    return "tools run on this machine, in " + where.root + " - never in the editor";
  }

  function modeText(session) {
    if (session === null || !session.mode) { return NO_MODE_YET; }
    const permits = permissionText(session.mode);
    return permits === "" ? session.mode : session.mode + " - " + permits;
  }

  function statusNode(state) {
    const box = el("div", "composer-status");
    box.appendChild(el("span", "status-where", whereText(state.where)));
    box.appendChild(el("span", "status-mode", modeText(sessionOf(state))));
    return box;
  }

  function node(state) {
    const session = sessionOf(state);
    const box = el("div", "composer");
    const field = el("div", "composer-box");
    const area = input();
    field.appendChild(area);
    const controls = el("div", "composer-controls");
    controls.appendChild(modeChip(session));
    controls.appendChild(modelChip(session));
    controls.appendChild(el("span", "composer-spacer"));
    controls.appendChild(sendChip(state, area));
    field.appendChild(controls);
    box.appendChild(field);
    box.appendChild(statusNode(state));
    return box;
  }

  return { node, whereText, modeText, PLACEHOLDER };
})();
