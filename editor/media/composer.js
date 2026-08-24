var jouleComposer = (function () {
  const { el, post, button, icon, hiddenText } = jouleDom;

  const PLACEHOLDER = "describe a change, or paste an error";
  const NO_MODE_YET = "the session has not said what may run yet";
  const GROW_MAX_PX = 160;
  const CONTEXT_PREFIX = "active file: ";

  let draft = "";
  let dismissedFile = "";

  function sessionOf(state) {
    return state.conversation ? state.conversation.session : null;
  }

  function activeContext(state) {
    const file = state.activeFile || null;
    if (file === null || file.rel === dismissedFile) { return null; }
    return file;
  }

  function grow(area) {
    area.style.height = "auto";
    area.style.height = Math.min(area.scrollHeight, GROW_MAX_PX) + "px";
  }

  function send(area, state) {
    if (area.value.trim() === "") { return; }
    const context = activeContext(state);
    const text = context === null ? area.value : CONTEXT_PREFIX + context.rel + "\n" + area.value;
    post("submit", { text });
    draft = "";
    area.value = "";
    grow(area);
  }

  function input(state, arm) {
    const area = document.createElement("textarea");
    area.className = "composer-input";
    area.rows = 1;
    area.placeholder = PLACEHOLDER;
    area.value = draft;
    area.addEventListener("input", () => {
      draft = area.value;
      grow(area);
      arm();
    });
    area.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send(area, state);
        arm();
      }
    });
    requestAnimationFrame(() => grow(area));
    return area;
  }

  function contextRow(state) {
    const row = el("div", "composer-context");
    const add = button("chip context-add", "", () => {});
    add.disabled = true;
    add.title = "picking files to send is not built yet. the file open beside the panel is named automatically.";
    add.appendChild(icon("plus"));
    add.appendChild(hiddenText("add context"));
    row.appendChild(add);
    const context = activeContext(state);
    if (context !== null) {
      const chip = button("context-chip", "", () => {
        dismissedFile = context.rel;
        chip.remove();
      });
      chip.title = context.rel + " is named at the top of your message. joule reads files itself when the turn runs. click to leave it out.";
      chip.appendChild(el("span", "context-name", context.name));
      chip.appendChild(icon("x"));
      row.appendChild(chip);
    }
    return row;
  }

  function modeControl(session) {
    const hold = el("span", "chip mode-hold");
    hold.title = "what may run without being asked. the same thing /mode sets in a terminal.";
    hold.appendChild(icon("shield"));
    const select = el("select", "mode-chip");
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
    select.addEventListener("change", () => post("mode", { mode: select.value }));
    hold.appendChild(select);
    return hold;
  }

  function modelControl(session) {
    const label = session === null || !session.model ? "model" : session.model;
    const chip = button("chip model-chip", "", () => post("model"));
    chip.disabled = session === null;
    chip.title = "the model this session drives. the same thing /model sets in a terminal.";
    chip.appendChild(icon("model"));
    chip.appendChild(el("span", "chip-label", label));
    return chip;
  }

  function sendControl(state, area) {
    if (state.conversation && state.conversation.turnActive) {
      const stop = button("chip composer-send composer-stop", "", () => post("cancel"));
      stop.title = "stop the turn that is running";
      stop.appendChild(icon("stop"));
      stop.appendChild(hiddenText("stop"));
      return stop;
    }
    const chip = button("chip composer-send", "", () => send(area, state));
    chip.title = "enter sends, shift-enter starts a new line";
    chip.appendChild(icon("send"));
    chip.appendChild(hiddenText("send"));
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
    const where = el("span", "status-where");
    where.appendChild(icon("monitor"));
    where.appendChild(el("span", "status-text", whereText(state.where)));
    box.appendChild(where);
    const mode = el("span", "status-mode");
    mode.appendChild(icon("shield"));
    mode.appendChild(el("span", "status-text", modeText(sessionOf(state))));
    box.appendChild(mode);
    return box;
  }

  function node(state) {
    const session = sessionOf(state);
    const box = el("div", "composer");
    const field = el("div", "composer-box");
    field.appendChild(contextRow(state));
    let sendChip = null;
    const arm = () => {
      if (sendChip !== null) { sendChip.classList.toggle("armed", area.value.trim() !== ""); }
    };
    const area = input(state, arm);
    field.appendChild(area);
    const controls = el("div", "composer-controls");
    controls.appendChild(modeControl(session));
    controls.appendChild(modelControl(session));
    controls.appendChild(el("span", "composer-spacer"));
    sendChip = sendControl(state, area);
    controls.appendChild(sendChip);
    arm();
    field.appendChild(controls);
    box.appendChild(field);
    box.appendChild(statusNode(state));
    return box;
  }

  return { node, whereText, modeText, PLACEHOLDER, CONTEXT_PREFIX };
})();
