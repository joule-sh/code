export const PAGE_HTML_BODY: string = `
<div id="app">
  <div id="pair-screen">
    <h1>joule code</h1>
    <div class="pair-box">
      <input id="pair-code" maxlength="6" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="CODE" />
      <button id="pair-submit" type="button">Pair</button>
      <div id="pair-error"></div>
    </div>
  </div>
  <div id="session-screen" class="hidden">
    <div id="status-bar" class="status-bar status-connecting">
      <div class="status-dot"></div>
      <div id="status-text">connecting</div>
    </div>
    <div id="transcript"></div>
    <div id="cancel-row" class="hidden">
      <button id="cancel-button" type="button">Cancel current turn</button>
    </div>
    <div id="compose">
      <textarea id="compose-input" rows="1" placeholder="Message"></textarea>
      <button id="compose-send" type="button">Send</button>
    </div>
  </div>
</div>
`;
