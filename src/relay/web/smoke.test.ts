import { PAGE_CSS } from "./page_css.ts";
import { PAGE_HTML_BODY } from "./page_html.ts";
import { PAGE_JS_FRAMES } from "./page_js_frames.ts";
import { PAGE_JS_CLIENT } from "./page_js_client.ts";
import { renderWebPage, WEB_PAGE_PATH } from "./web_page.ts";

test("PAGE_CSS is non-empty and mentions the transcript", () => {
  expect(PAGE_CSS.length > 0);
  expect(PAGE_CSS.indexOf("#transcript") >= 0);
});

test("PAGE_HTML_BODY is non-empty and has the pair screen", () => {
  expect(PAGE_HTML_BODY.length > 0);
  expect(PAGE_HTML_BODY.indexOf("pair-screen") >= 0);
});

test("PAGE_JS_FRAMES defines the fixture and renderer functions", () => {
  expect(PAGE_JS_FRAMES.indexOf("function fixtureScript") >= 0);
  expect(PAGE_JS_FRAMES.indexOf("function renderFrameText") >= 0);
});

test("PAGE_JS_CLIENT defines pairing and websocket wiring", () => {
  expect(PAGE_JS_CLIENT.indexOf("function submitPair") >= 0);
  expect(PAGE_JS_CLIENT.indexOf("function connectWs") >= 0);
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
