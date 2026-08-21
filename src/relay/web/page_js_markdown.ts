export const PAGE_JS_MARKDOWN: string = `
var MD_BACKTICK = String.fromCharCode(96);
var MD_CODE_FENCE = MD_BACKTICK + MD_BACKTICK + MD_BACKTICK;
var MD_MAX_HEADER_LEVEL = 6;
var MD_BOLD_MARKER = "**";

function mdIsWordByte(ch) {
  if (!ch) { return false; }
  var c = ch.charCodeAt(0);
  if (c >= 48 && c <= 57) { return true; }
  if (c >= 65 && c <= 90) { return true; }
  if (c >= 97 && c <= 122) { return true; }
  return c === 95;
}

function mdCharAtOr(text, index) {
  if (index < 0 || index >= text.length) { return ""; }
  return text.charAt(index);
}

function mdHeaderLevel(line) {
  var i = 0;
  var n = line.length;
  while (i < n && i < MD_MAX_HEADER_LEVEL && line.charAt(i) === "#") { i++; }
  if (i === 0) { return 0; }
  if (i < n && line.charAt(i) === " ") { return i; }
  return 0;
}

function mdIsFenceLine(line) {
  var t = line.trim();
  return t.length >= 3 && t.slice(0, 3) === MD_CODE_FENCE;
}

function mdFindCodeSpans(line) {
  var out = [];
  var i = 0;
  var n = line.length;
  while (i < n) {
    if (line.charAt(i) === MD_BACKTICK) {
      var close = line.indexOf(MD_BACKTICK, i + 1);
      if (close >= 0) {
        out.push({ open: i, close: close });
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  return out;
}

function mdCodeSpanCloseAt(spans, index) {
  for (var i = 0; i < spans.length; i++) {
    if (spans[i].open === index) { return spans[i].close; }
  }
  return -1;
}

function mdInsideCodeSpan(spans, index) {
  for (var i = 0; i < spans.length; i++) {
    if (index >= spans[i].open && index <= spans[i].close) { return true; }
  }
  return false;
}

function mdTokenizeBold(text, spans, start) {
  var n = text.length;
  var m = MD_BOLD_MARKER.length;
  if (start + m > n || text.slice(start, start + m) !== MD_BOLD_MARKER) { return null; }
  var i = start + m;
  while (i + m <= n) {
    if (!mdInsideCodeSpan(spans, i) && text.slice(i, i + m) === MD_BOLD_MARKER) {
      return { type: "bold", text: text.slice(start + m, i), next: i + m };
    }
    i++;
  }
  return null;
}

function mdTokenizeItalic(text, spans, start) {
  if (text.charAt(start) !== "_" || mdIsWordByte(mdCharAtOr(text, start - 1))) { return null; }
  var n = text.length;
  var i = start + 1;
  while (i < n) {
    if (!mdInsideCodeSpan(spans, i) && text.charAt(i) === "_" && !mdIsWordByte(mdCharAtOr(text, i + 1))) {
      if (i > start + 1) { return { type: "italic", text: text.slice(start + 1, i), next: i + 1 }; }
      return null;
    }
    i++;
  }
  return null;
}

function mdTokenizeInline(text) {
  var spans = mdFindCodeSpans(text);
  var out = [];
  var plain = "";
  var i = 0;
  var n = text.length;
  while (i < n) {
    var codeClose = mdCodeSpanCloseAt(spans, i);
    if (codeClose >= 0) {
      if (plain) { out.push({ type: "text", text: plain }); plain = ""; }
      out.push({ type: "code", text: text.slice(i + 1, codeClose) });
      i = codeClose + 1;
      continue;
    }
    var emphasis = mdTokenizeBold(text, spans, i);
    if (!emphasis) { emphasis = mdTokenizeItalic(text, spans, i); }
    if (emphasis) {
      if (plain) { out.push({ type: "text", text: plain }); plain = ""; }
      out.push({ type: emphasis.type, children: mdTokenizeInline(emphasis.text) });
      i = emphasis.next;
      continue;
    }
    plain += text.charAt(i);
    i++;
  }
  if (plain) { out.push({ type: "text", text: plain }); }
  return out;
}

function mdAppendTokens(container, tokens) {
  for (var i = 0; i < tokens.length; i++) {
    var tok = tokens[i];
    if (tok.type === "code") {
      var codeEl = document.createElement("code");
      codeEl.className = "md-inline-code";
      codeEl.textContent = tok.text;
      container.appendChild(codeEl);
      continue;
    }
    if (tok.type === "bold") {
      var boldEl = document.createElement("b");
      mdAppendTokens(boldEl, tok.children);
      container.appendChild(boldEl);
      continue;
    }
    if (tok.type === "italic") {
      var em = document.createElement("em");
      mdAppendTokens(em, tok.children);
      container.appendChild(em);
      continue;
    }
    container.appendChild(document.createTextNode(tok.text));
  }
}

function mdAppendInline(container, line) {
  mdAppendTokens(container, mdTokenizeInline(line));
}

function mdRenderLineInto(container, line, st) {
  if (mdIsFenceLine(line)) {
    st.mdInCodeBlock = !st.mdInCodeBlock;
    var fenceEl = document.createElement("div");
    fenceEl.className = "md-fence";
    container.appendChild(fenceEl);
    return;
  }
  if (st.mdInCodeBlock) {
    var codeLine = document.createElement("div");
    codeLine.className = "md-code-line";
    codeLine.textContent = line;
    container.appendChild(codeLine);
    return;
  }
  var level = mdHeaderLevel(line);
  if (level > 0) {
    var h = document.createElement("div");
    h.className = "md-header";
    h.textContent = line.slice(level + 1);
    container.appendChild(h);
    return;
  }
  var p = document.createElement("div");
  p.className = "md-line";
  mdAppendInline(p, line);
  container.appendChild(p);
}
`;
