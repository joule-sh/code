import { appendMailbox } from "../tasks/mailbox.ts";

export const RELEASES_URL: string = "https://api.github.com/repos/joule-sh/code/releases/latest";
export const TAG_OK: string = "OK";
export const TAG_ERR: string = "ERR";

let g_check_url: string = "";
let g_check_mailbox: string = "";

export function configureUpdateWorker(url: string, mailboxPath: string): void {
  g_check_url = url;
  g_check_mailbox = mailboxPath;
}

export function updateCheckLoop(): int {
  let headers = new Map<string, string>();
  headers.set("Accept", "application/vnd.github+json");
  headers.set("User-Agent", "joule-code-update-check");
  let resp = http.request(g_check_url, "GET", "", headers);
  if (resp.ok) {
    appendMailbox(g_check_mailbox, TAG_OK, resp.body);
  } else {
    appendMailbox(g_check_mailbox, TAG_ERR, `${resp.status}`);
  }
  return 0;
}

export function spawnUpdateCheck(): Promise<int> {
  return Worker.run(() => { return updateCheckLoop(); });
}
