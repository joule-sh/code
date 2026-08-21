export const PAGE_CSS: string = `
:root {
  --bg: #0d1117;
  --panel: #161b22;
  --border: #30363d;
  --text: #e6edf3;
  --muted: #8b949e;
  --accent: #2f81f7;
  --ok: #3fb950;
  --fail: #f85149;
  --warn: #d29922;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 16px;
  width: 100%;
  overflow-x: hidden;
}
#app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 0.75rem;
}
.hidden { display: none !important; }
h1 {
  font-size: 1.1rem;
  margin: 0 0 1rem 0;
  color: var(--muted);
  font-weight: 600;
}
.pair-box {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 2rem;
}
#pair-code {
  font-size: 2rem;
  letter-spacing: 0.3em;
  text-align: center;
  padding: 0.75rem;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  color: var(--text);
  text-transform: uppercase;
  width: 100%;
}
button {
  font-family: inherit;
  font-size: 1.1rem;
  padding: 0.9rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border);
  background: var(--accent);
  color: white;
  min-height: 3rem;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
#pair-error {
  color: var(--fail);
  min-height: 1.2rem;
}
.status-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
  color: var(--muted);
  font-size: 0.85rem;
  border-bottom: 1px solid var(--border);
  margin-bottom: 0.5rem;
}
.status-dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  background: var(--muted);
  flex-shrink: 0;
}
.status-connected .status-dot { background: var(--ok); }
.status-connecting .status-dot, .status-reconnecting .status-dot { background: var(--warn); }
.status-disconnected .status-dot { background: var(--fail); }
#transcript {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-bottom: 1rem;
  min-height: 0;
}
.line {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.4;
}
.line-text { color: var(--text); }
.line-tool { color: var(--muted); }
.line-result-ok { color: var(--ok); }
.line-result-fail { color: var(--fail); }
.line-turn-end { color: var(--muted); font-style: italic; }
.result-collapse > summary {
  cursor: pointer;
  list-style: none;
  white-space: pre-wrap;
  word-break: break-word;
}
.result-collapse > summary::-webkit-details-marker { display: none; }
.result-preview { display: block; }
.result-more {
  display: block;
  color: var(--muted);
  font-style: italic;
}
.result-rest {
  white-space: pre-wrap;
  word-break: break-word;
}
.line-error { color: var(--fail); font-weight: 600; }
.md-header { font-weight: 700; color: var(--accent); }
.md-fence { display: none; }
.md-code-line {
  font-family: inherit;
  white-space: pre-wrap;
  word-break: break-word;
  border-left: 2px solid var(--border);
  padding-left: 0.5rem;
  background: rgba(255, 255, 255, 0.03);
}
.md-inline-code {
  font-family: inherit;
  background: rgba(255, 255, 255, 0.08);
  padding: 0 0.25rem;
  border-radius: 0.2rem;
}
.card {
  border: 1px solid var(--warn);
  border-radius: 0.5rem;
  padding: 0.75rem;
  background: var(--panel);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.card-title { font-weight: 600; }
.card-detail {
  color: var(--muted);
  font-size: 0.9rem;
  white-space: pre-wrap;
  word-break: break-word;
}
.card-buttons {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.card-buttons button {
  flex: 1;
  min-width: 5.5rem;
}
.btn-allow { background: var(--ok); }
.btn-deny { background: var(--fail); }
.btn-always { background: var(--accent); }
.card-decided {
  color: var(--muted);
  font-style: italic;
}
#compose {
  display: flex;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border);
}
#compose-input {
  flex: 1;
  font-family: inherit;
  font-size: 1rem;
  padding: 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  min-height: 3rem;
  resize: none;
}
#compose button { flex-shrink: 0; }
#cancel-row {
  padding: 0.4rem 0;
}
#cancel-row button {
  width: 100%;
  background: var(--fail);
  min-height: 2.5rem;
  font-size: 0.95rem;
}
@media (max-width: 480px) {
  #app { padding: 0.5rem; }
  button { font-size: 1rem; }
}
`;
