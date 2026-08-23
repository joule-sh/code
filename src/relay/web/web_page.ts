import { PAGE_CSS } from "./page_css.ts";
import { PAGE_HTML_BODY } from "./page_html.ts";
import { PAGE_JS_FRAMES } from "./page_js_frames.ts";
import { PAGE_JS_MARKDOWN } from "./page_js_markdown.ts";
import { PAGE_JS_CLIENT } from "./page_js_client.ts";

export const WEB_PAGE_PATH: string = "/";
export const FRAMES_ASSET_PATH: string = "/web/frames.js";

// The frame vocabulary on its own, for a page this relay does not serve.
// One copy exists, and handing it out is what stops a second being written.
export function renderFramesAsset(): string {
  return PAGE_JS_FRAMES + PAGE_JS_MARKDOWN;
}

function configScript(wsBrowserPort: int): string {
  return "window.__JOULE_CONFIG__ = { wsPort: " + `${wsBrowserPort}` + " };";
}

export function renderWebPage(wsBrowserPort: int): string {
  let script = configScript(wsBrowserPort) + PAGE_JS_FRAMES + PAGE_JS_MARKDOWN + PAGE_JS_CLIENT;
  let out = "<!doctype html>\n"
    + "<html lang=\"en\">\n"
    + "<head>\n"
    + "<meta charset=\"utf-8\">\n"
    + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1\">\n"
    + "<title>joule code</title>\n"
    + "<style>" + PAGE_CSS + "</style>\n"
    + "</head>\n"
    + "<body>\n"
    + PAGE_HTML_BODY
    + "<script>" + script + "</script>\n"
    + "</body>\n"
    + "</html>\n";
  return out;
}
