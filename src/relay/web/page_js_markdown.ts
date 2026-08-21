export const PAGE_JS_MARKDOWN: string = `
var MD_BACKTICK = String.fromCharCode(96);
var MD_CODE_FENCE = MD_BACKTICK + MD_BACKTICK + MD_BACKTICK;
var MD_MAX_HEADER_LEVEL = 6;

function mdIsWordByte(ch) {
  if (!ch) { return false; }
  var c = ch.charCodeAt(0);
  if (c >= 48 && c <= 57) { return true; }
  if (c >= 65 && c <= 90) { return true; }
  if (c >= 97 && c <= 122) { return true; }
  return c === 95;
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

function mdSplitCodeSpans(line) {
  var out = [];
  var i = 0;
  var n = line.length;
  var plainStart = 0;
  while (i < n) {
    if (line.charAt(i) === MD_BACKTICK) {
      var close = line.indexOf(MD_BACKTICK, i + 1);
      if (close >= 0) {
        if (i > plainStart) { out.push({ text: line.slice(plainStart, i), isCode: false }); }
        out.push({ text: line.slice(i + 1, close), isCode: true });
        i = close + 1;
        plainStart = i;
        continue;
      }
    }
    i++;
  }
  if (plainStart < n) { out.push({ text: line.slice(plainStart, n), isCode: false }); }
  return out;
}

function mdTokenizeBold(text) {
  var out = [];
  var i = 0;
  var n = text.length;
  var plain = "";
  while (i < n) {
    if (i + 2 <= n && text.slice(i, i + 2) === "**") {
      var close = text.indexOf("**", i + 2);
      if (close >= 0) {
        if (plain) { out.push({ type: "text", text: plain }); plain = ""; }
        out.push({ type: "bold", text: text.slice(i + 2, close) });
        i = close + 2;
        continue;
      }
    }
    plain += text.charAt(i);
    i++;
  }
  if (plain) { out.push({ type: "text", text: plain }); }
  return out;
}

function mdTokenizeItalic(text) {
  var out = [];
  var i = 0;
  var n = text.length;
  var plain = "";
  while (i < n) {
    if (text.charAt(i) === "_" && !mdIsWordByte(i > 0 ? text.charAt(i - 1) : "")) {
      var close = -1;
      var j = i + 1;
      while (j < n) {
        if (text.charAt(j) === "_" && !mdIsWordByte(j + 1 < n ? text.charAt(j + 1) : "")) { close = j; break; }
        j++;
      }
      if (close > i + 1) {
        if (plain) { out.push({ type: "text", text: plain }); plain = ""; }
        out.push({ type: "italic", text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    plain += text.charAt(i);
    i++;
  }
  if (plain) { out.push({ type: "text", text: plain }); }
  return out;
}

function mdAppendItalicInto(container, text) {
  var tokens = mdTokenizeItalic(text);
  for (var i = 0; i < tokens.length; i++) {
    var tok = tokens[i];
    if (tok.type === "italic") {
      var em = document.createElement("em");
      em.textContent = tok.text;
      container.appendChild(em);
    } else {
      container.appendChild(document.createTextNode(tok.text));
    }
  }
}

function mdAppendInline(container, line) {
  var segments = mdSplitCodeSpans(line);
  for (var s = 0; s < segments.length; s++) {
    var seg = segments[s];
    if (seg.isCode) {
      var codeEl = document.createElement("code");
      codeEl.className = "md-inline-code";
      codeEl.textContent = seg.text;
      container.appendChild(codeEl);
      continue;
    }
    var boldTokens = mdTokenizeBold(seg.text);
    for (var b = 0; b < boldTokens.length; b++) {
      var btok = boldTokens[b];
      if (btok.type === "bold") {
        var boldEl = document.createElement("b");
        mdAppendItalicInto(boldEl, btok.text);
        container.appendChild(boldEl);
      } else {
        mdAppendItalicInto(container, btok.text);
      }
    }
  }
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
