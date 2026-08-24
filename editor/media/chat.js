(function () {
  const { el, post, button, wordmark } = jouleDom;
  const root = document.getElementById("root");
  let state = null;

  function version() {
    if (state.binary && state.binary.ok) { return state.binary.version; }
    return state.binaryVersion || "";
  }

  function sessionOf() {
    return state.conversation ? state.conversation.session : null;
  }

  function attached() {
    return state.state === "attached" || state.state === "retrying" || state.state === "starting";
  }

  function firstRun() {
    if (state.blocked) { return true; }
    if (state.binary && !state.binary.ok) { return true; }
    if (state.state === "failed") { return true; }
    return !(state.setup && state.setup.configured);
  }

  function headerNode() {
    const head = el("div", "header");
    const left = el("div", "header-left");
    left.appendChild(wordmark(version()));
    left.appendChild(el("span", "header-workspace", state.where && state.where.root ? state.where.root : "no workspace folder"));
    const session = sessionOf();
    if (session) { left.appendChild(el("span", "header-meta", session.model + " - " + session.mode)); }
    head.appendChild(left);
    const right = el("div", "header-right");
    right.appendChild(el("span", "badge badge-" + state.state, state.state));
    if (attached()) { right.appendChild(button("link header-detach", "detach", () => post("detach"))); }
    head.appendChild(right);
    if (state.detail && state.state === "retrying") { head.appendChild(el("div", "header-detail", state.detail)); }
    return head;
  }

  function factRow(label, value) {
    const row = el("div", "fact");
    row.appendChild(el("span", "fact-label", label));
    row.appendChild(el("span", "fact-value", value));
    return row;
  }

  function modelVia(setup) {
    if (setup.keySource === "env") { return "an api key from this window's environment"; }
    if (setup.keySource === "file") { return "the provider key in " + setup.configPath; }
    if (setup.account) { return "your joule account, " + setup.account; }
    return "nothing yet";
  }

  function whereValue() {
    const where = state.where || {};
    if (where.remote) { return "on " + where.host + ", the machine this window is connected to"; }
    return "on this machine";
  }

  function factsNode() {
    const setup = state.setup || {};
    const box = el("div", "facts");
    box.appendChild(factRow("workspace", state.where && state.where.root ? state.where.root : "no folder"));
    box.appendChild(factRow("tools run", whereValue()));
    box.appendChild(factRow("model via", modelVia(setup)));
    if (setup.server && !setup.serverIsDefault) { box.appendChild(factRow("server", setup.server)); }
    if (state.daemonAlreadyRunning && state.daemonStartedAt) {
      box.appendChild(factRow("daemon", "running since " + state.daemonStartedAt));
    }
    return box;
  }

  function gateNode() {
    const box = el("div", "gate");
    box.appendChild(el("p", "gate-text", state.daemonAlreadyRunning
      ? "a joule daemon is already running for this folder. attaching joins that session, so if someone is driving it from a terminal you will both be in it."
      : "no joule daemon is running for this folder. attaching starts one here, where the files are."));
    box.appendChild(factsNode());
    box.appendChild(button("primary", state.daemonAlreadyRunning ? "attach to this session" : "start a session", () => post("attach")));
    if (state.note) { box.appendChild(el("p", "gate-note", state.note)); }
    return box;
  }

  function keepFocus(activeClass, caret) {
    if (activeClass !== "composer-input") { return; }
    const area = root.querySelector(".composer-input");
    if (area === null) { return; }
    area.focus();
    if (caret >= 0) { area.setSelectionRange(caret, caret); }
  }

  function render() {
    const atBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 40;
    const active = document.activeElement;
    const activeClass = active ? active.className : "";
    const caret = activeClass === "composer-input" ? active.selectionStart : -1;

    root.textContent = "";
    if (state === null) { return; }

    if (!attached() && firstRun()) {
      root.appendChild(jouleFirstRun.node(state));
      return;
    }

    root.appendChild(headerNode());
    if (!attached()) {
      root.appendChild(gateNode());
      return;
    }

    root.appendChild(jouleTranscript.node(state));
    root.appendChild(jouleComposer.node(state));
    keepFocus(activeClass, caret);
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
