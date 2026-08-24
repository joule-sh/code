export const PAGE_JS_CLIENT: string = `
var STORAGE_KEY = "joule.webUserId";
var BACKOFF_START_MS = 500;
var BACKOFF_CAP_MS = 10000;
var OUTBOUND_BUFFER_CAP = 500;
var CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
var CODE_LENGTH = 6;

var state = {
  userId: null,
  sessionId: null,
  ws: null,
  status: "connecting",
  lastSeq: -1,
  backoffMs: BACKOFF_START_MS,
  reconnectTimer: null,
  everConnected: false,
  outbound: [],
  currentTextEl: null,
  currentTurnId: null,
  toolCards: {},
  mdPending: "",
  mdInCodeBlock: false
};

function flushMarkdown() {
  if (state.mdPending !== "") {
    if (!state.currentTextEl) { state.currentTextEl = appendLine("line-text", ""); }
    mdRenderLineInto(state.currentTextEl, state.mdPending, state);
  }
  state.mdPending = "";
  state.mdInCodeBlock = false;
}

function nextBackoffMs(currentMs) {
  var doubled = currentMs * 2;
  if (doubled > BACKOFF_CAP_MS) { return BACKOFF_CAP_MS; }
  if (doubled < BACKOFF_START_MS) { return BACKOFF_START_MS; }
  return doubled;
}

function byId(id) {
  return document.getElementById(id);
}

function randomHex(byteLength) {
  var bytes = new Uint8Array(byteLength);
  if (window.crypto && typeof window.crypto.getRandomValues === "function") {
    window.crypto.getRandomValues(bytes);
  } else {
    for (var i = 0; i < byteLength; i++) { bytes[i] = Math.floor(Math.random() * 256); }
  }
  var out = "";
  for (var j = 0; j < bytes.length; j++) {
    var hex = bytes[j].toString(16);
    if (hex.length < 2) { hex = "0" + hex; }
    out = out + hex;
  }
  return out;
}

function newPseudoId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return randomHex(16);
}

function getOrCreateUserId() {
  var existing = null;
  try { existing = window.localStorage.getItem(STORAGE_KEY); } catch (e) { existing = null; }
  if (existing) { return existing; }
  var created = newPseudoId();
  try { window.localStorage.setItem(STORAGE_KEY, created); } catch (e) { }
  return created;
}

function setStatus(status) {
  state.status = status;
  var bar = byId("status-bar");
  bar.className = "status-bar status-" + status;
  byId("status-text").textContent = status;
}

function scrollTranscriptToEnd() {
  var t = byId("transcript");
  t.scrollTop = t.scrollHeight;
}

function appendLine(cls, text) {
  var el = document.createElement("div");
  el.className = "line " + cls;
  el.textContent = text;
  byId("transcript").appendChild(el);
  scrollTranscriptToEnd();
  return el;
}

function showCancelRow(show) {
  var row = byId("cancel-row");
  if (show) { row.classList.remove("hidden"); } else { row.classList.add("hidden"); }
}

function renderApprovalCard(f) {
  var card = document.createElement("div");
  card.className = "card";
  var title = document.createElement("div");
  title.className = "card-title";
  title.textContent = f.summary;
  card.appendChild(title);
  var detail = document.createElement("div");
  detail.className = "card-detail";
  detail.textContent = f.detail;
  card.appendChild(detail);
  var buttons = document.createElement("div");
  buttons.className = "card-buttons";
  buttons.appendChild(approvalButton("Allow", "btn-allow", f.callId, DECISION_ALLOW, card));
  buttons.appendChild(approvalButton("Deny", "btn-deny", f.callId, DECISION_DENY, card));
  buttons.appendChild(approvalButton("Always", "btn-always", f.callId, DECISION_ALWAYS, card));
  card.appendChild(buttons);
  byId("transcript").appendChild(card);
  scrollTranscriptToEnd();
}

function approvalButton(label, cls, callId, decision, card) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = cls;
  btn.textContent = label;
  btn.addEventListener("click", function () {
    sendFrame(encodeApprovalReplyFrame(callId, decision));
    var buttons = card.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) { buttons[i].disabled = true; }
    var decided = document.createElement("div");
    decided.className = "card-decided";
    decided.textContent = "you chose: " + decision;
    card.appendChild(decided);
  });
  return btn;
}

function buildResultElement(status, out, ok) {
  var cls = ok ? "line-result-ok" : "line-result-fail";
  var plan = planToolOutputCollapseJs(out);
  if (plan.hidden <= 0) {
    var plain = document.createElement("div");
    plain.className = "line " + cls;
    plain.textContent = status + ": " + out;
    return plain;
  }
  var box = document.createElement("details");
  box.className = "line " + cls + " result-collapse";
  var summary = document.createElement("summary");
  var preview = document.createElement("span");
  preview.className = "result-preview";
  preview.textContent = status + ": " + plan.head;
  var more = document.createElement("span");
  more.className = "result-more";
  more.textContent = "... +" + plan.hidden + " lines";
  summary.appendChild(preview);
  summary.appendChild(more);
  var rest = document.createElement("div");
  rest.className = "result-rest";
  rest.textContent = plan.body;
  box.appendChild(summary);
  box.appendChild(rest);
  box.addEventListener("toggle", function () {
    more.textContent = box.open ? "... " + plan.hidden + " more lines" : "... +" + plan.hidden + " lines";
  });
  return box;
}

function applyFrameToTranscript(frameJson) {
  var f = decodeFrame(frameJson);
  if (f === null) { return; }
  var seqValue = typeof f.seq === "number" ? f.seq : -1;
  if (seqValue > state.lastSeq) { state.lastSeq = seqValue; }
  var kind = f.type;
  if (kind !== TEXT_DELTA) { flushMarkdown(); }

  if (kind === TURN_START) {
    state.currentTextEl = null;
    state.currentTurnId = f.turnId;
    if (typeof f.prompt === "string" && f.prompt !== "") { appendLine("line-prompt", "> " + f.prompt); }
    showCancelRow(true);
    return;
  }
  if (kind === TEXT_DELTA) {
    if (!state.currentTextEl) {
      state.currentTextEl = appendLine("line-text", "");
    }
    state.currentTextEl.textContent = state.currentTextEl.textContent + f.text;
    scrollTranscriptToEnd();
    return;
  }
  if (kind === TOOL_CALL) {
    state.currentTextEl = null;
    var card = document.createElement("div");
    card.className = "card";
    var title = document.createElement("div");
    title.className = "card-title line-tool";
    title.textContent = "-> " + f.tool + " " + f.args;
    card.appendChild(title);
    byId("transcript").appendChild(card);
    state.toolCards[f.callId] = card;
    scrollTranscriptToEnd();
    return;
  }
  if (kind === TOOL_RESULT) {
    var status = f.ok ? "ok" : "failed";
    var out = f.output;
    if (f.truncated) { out = out + " (truncated)"; }
    var line = buildResultElement(status, out, f.ok);
    var existingCard = state.toolCards[f.callId];
    if (existingCard) {
      existingCard.appendChild(line);
    } else {
      byId("transcript").appendChild(line);
    }
    scrollTranscriptToEnd();
    return;
  }
  if (kind === APPROVAL_REQUEST) {
    state.currentTextEl = null;
    renderApprovalCard(f);
    return;
  }
  if (kind === TURN_END) {
    state.currentTextEl = null;
    state.currentTurnId = null;
    showCancelRow(false);
    if (f.reason === REASON_CANCELLED) { appendLine("line-turn-end", "(cancelled)"); }
    if (f.reason === REASON_ERROR) { appendLine("line-turn-end", "(error)"); }
    return;
  }
  if (kind === ERROR_FRAME) {
    appendLine("line-error", "! " + f.code + ": " + f.message);
    return;
  }
  if (kind === NOTICE_FRAME) {
    var mark = f.level === LEVEL_WARN ? "! " : "";
    appendLine(noticeLineClass(f.level), mark + f.message);
    return;
  }
  appendLine("line-unknown", "(unrenderable frame: " + kind + ")");
}

function wsPort() {
  if (window.__JOULE_CONFIG__ && window.__JOULE_CONFIG__.wsPort) {
    return window.__JOULE_CONFIG__.wsPort;
  }
  return Number(window.location.port || "80") + 2;
}

function wsUrl() {
  var scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  var slash = "/";
  return scheme + slash + slash + window.location.hostname + ":" + wsPort() + "/w/" + state.sessionId + "/ws?x-user=" + encodeURIComponent(state.userId);
}

function connectWs() {
  if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
  setStatus(state.everConnected ? "reconnecting" : "connecting");
  var socket;
  try {
    socket = new WebSocket(wsUrl());
  } catch (e) {
    setStatus("disconnected");
    scheduleReconnect();
    return;
  }
  state.ws = socket;
  socket.onopen = function () {
    socket.send(encodeResumeFrame(state.lastSeq));
    flushOutbound();
    setStatus("connected");
    state.everConnected = true;
    state.backoffMs = BACKOFF_START_MS;
  };
  socket.onmessage = function (event) {
    applyFrameToTranscript(event.data);
  };
  socket.onclose = function () {
    setStatus("disconnected");
    scheduleReconnect();
  };
  socket.onerror = function () {
    socket.close();
  };
}

function scheduleReconnect() {
  if (state.reconnectTimer) { return; }
  var delay = state.backoffMs;
  state.backoffMs = nextBackoffMs(state.backoffMs);
  state.reconnectTimer = setTimeout(function () {
    state.reconnectTimer = null;
    connectWs();
  }, delay);
}

function sendFrame(frameJson) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(frameJson);
    return;
  }
  state.outbound.push(frameJson);
  if (state.outbound.length > OUTBOUND_BUFFER_CAP) { state.outbound.shift(); }
}

function flushOutbound() {
  var pending = state.outbound;
  state.outbound = [];
  for (var i = 0; i < pending.length; i++) {
    state.ws.send(pending[i]);
  }
}

function normalizeCode(raw) {
  var out = "";
  var upper = raw.toUpperCase();
  for (var i = 0; i < upper.length && out.length < CODE_LENGTH; i++) {
    if (CODE_ALPHABET.indexOf(upper.charAt(i)) >= 0) { out = out + upper.charAt(i); }
  }
  return out;
}

function showPairError(message) {
  byId("pair-error").textContent = message;
}

function submitPair() {
  var code = byId("pair-code").value;
  if (code.length !== CODE_LENGTH) {
    showPairError("enter the 6 character code");
    return;
  }
  byId("pair-submit").disabled = true;
  showPairError("");
  fetch(window.location.origin + "/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user": state.userId },
    body: JSON.stringify({ code: code })
  }).then(function (resp) {
    return resp.text().then(function (text) {
      return { ok: resp.ok, text: text };
    });
  }).then(function (result) {
    byId("pair-submit").disabled = false;
    var parsed = null;
    try { parsed = JSON.parse(result.text); } catch (e) { parsed = null; }
    if (!result.ok || !parsed || !parsed.sessionId) {
      var message = (parsed && parsed.error) ? parsed.error : "pairing failed";
      showPairError(message);
      return;
    }
    state.sessionId = parsed.sessionId;
    byId("pair-screen").classList.add("hidden");
    byId("session-screen").classList.remove("hidden");
    connectWs();
  }).catch(function (err) {
    byId("pair-submit").disabled = false;
    showPairError("could not reach the relay");
  });
}

function submitInput() {
  var input = byId("compose-input");
  var text = input.value;
  if (text.replace(/\\s/g, "") === "") { return; }
  sendFrame(encodeInputFrame(text));
  input.value = "";
}

function submitCancel() {
  if (!state.currentTurnId) { return; }
  sendFrame(encodeCancelFrame(state.currentTurnId));
}

function initUi() {
  state.userId = getOrCreateUserId();
  byId("pair-code").addEventListener("input", function (e) {
    e.target.value = normalizeCode(e.target.value);
  });
  byId("pair-submit").addEventListener("click", submitPair);
  byId("pair-code").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { submitPair(); }
  });
  byId("compose-send").addEventListener("click", submitInput);
  byId("compose-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitInput();
    }
  });
  byId("cancel-button").addEventListener("click", submitCancel);
}

initUi();
`;
