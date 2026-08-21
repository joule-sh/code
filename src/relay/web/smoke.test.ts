import { PAGE_CSS } from "./page_css.ts";
import { PAGE_HTML_BODY } from "./page_html.ts";
import { PAGE_JS_FRAMES } from "./page_js_frames.ts";
import { PAGE_JS_MARKDOWN } from "./page_js_markdown.ts";
import { PAGE_JS_CLIENT } from "./page_js_client.ts";
import { renderWebPage, WEB_PAGE_PATH } from "./web_page.ts";

test("PAGE_CSS is non-empty and mentions the transcript", () => {
  expect(PAGE_CSS.length > 0);
  expect(PAGE_CSS.indexOf("#transcript") >= 0);
});

test("PAGE_CSS styles the markdown header, fence, and code classes", () => {
  expect(PAGE_CSS.indexOf(".md-header") >= 0);
  expect(PAGE_CSS.indexOf(".md-code-line") >= 0);
  expect(PAGE_CSS.indexOf(".md-inline-code") >= 0);
});

test("PAGE_CSS styles the collapsed tool result disclosure", () => {
  expect(PAGE_CSS.indexOf(".result-collapse") >= 0);
  expect(PAGE_CSS.indexOf(".result-preview") >= 0);
  expect(PAGE_CSS.indexOf(".result-more") >= 0);
  expect(PAGE_CSS.indexOf(".result-rest") >= 0);
});

test("PAGE_HTML_BODY is non-empty and has the pair screen", () => {
  expect(PAGE_HTML_BODY.length > 0);
  expect(PAGE_HTML_BODY.indexOf("pair-screen") >= 0);
});

test("PAGE_JS_FRAMES defines the fixture and renderer functions", () => {
  expect(PAGE_JS_FRAMES.indexOf("function fixtureScript") >= 0);
  expect(PAGE_JS_FRAMES.indexOf("function renderFrameText") >= 0);
});

test("PAGE_JS_MARKDOWN defines the streaming markdown line renderer", () => {
  expect(PAGE_JS_MARKDOWN.indexOf("function mdRenderLineInto") >= 0);
  expect(PAGE_JS_MARKDOWN.indexOf("function mdTokenizeBold") >= 0);
});

test("PAGE_JS_FRAMES carries the same tool output collapse policy the terminal uses", () => {
  expect(PAGE_JS_FRAMES.indexOf("function planToolOutputCollapseJs") >= 0);
  expect(PAGE_JS_FRAMES.indexOf("TOOL_OUTPUT_COLLAPSE_HEAD_LINES = 6") >= 0);
  expect(PAGE_JS_FRAMES.indexOf("TOOL_OUTPUT_COLLAPSE_MIN_LINES = 10") >= 0);
});

test("PAGE_JS_CLIENT builds a disclosure element for long tool output", () => {
  expect(PAGE_JS_CLIENT.indexOf("function buildResultElement") >= 0);
  expect(PAGE_JS_CLIENT.indexOf("createElement(\"details\")") >= 0);
  expect(PAGE_JS_CLIENT.indexOf("createElement(\"summary\")") >= 0);
});

test("PAGE_JS_CLIENT defines pairing, websocket wiring, and the markdown flush", () => {
  expect(PAGE_JS_CLIENT.indexOf("function submitPair") >= 0);
  expect(PAGE_JS_CLIENT.indexOf("function connectWs") >= 0);
  expect(PAGE_JS_CLIENT.indexOf("function flushMarkdown") >= 0);
});

test("renderWebPage assembles a self-contained document with no external references", () => {
  let page = renderWebPage(8092);
  expect(page.indexOf("<!doctype html>") >= 0);
  expect(page.indexOf("wsPort: 8092") >= 0);
  expect(page.indexOf("pair-screen") >= 0);
  expect(page.indexOf("http://") < 0);
  expect(page.indexOf("https://") < 0);
  expect(page.indexOf("<link") < 0);
  expect(page.indexOf("cdn") < 0);
  expect(WEB_PAGE_PATH == "/");
});
