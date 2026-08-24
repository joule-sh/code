import { appendFile } from "../vendor/platform/platform.ts";

const MAILBOX: string = "/tmp/joule-spike-mailbox.log";
const RELAY_HOST: string = "127.0.0.1";
const RELAY_PORT: int = 8475;
const HTTP_URL: string = "http://127.0.0.1:8476/";

function parseI64(s: string): i64 {
  let out: i64 = 0;
  let i: int = 0;
  while (i < s.length) {
    let c = s.charAt(i);
    let code = c.charCodeAt(0) - "0".charCodeAt(0);
    if (code < 0 || code > 9) { return -1; }
    out = out * 10 + code;
    i = i + 1;
  }
  return out;
}

function receiveLoop(): int {
  let sock = net.connect(RELAY_HOST, RELAY_PORT);
  let buffer = "";
  let count: int = 0;
  while (true) {
    let chunk = sock.read();
    if (chunk == "") { break; }
    buffer = buffer + chunk;
    while (true) {
      let nl = buffer.indexOf("\n");
      if (nl < 0) { break; }
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1, buffer.length);
      if (line == "END") { sock.close(); return count; }
      let recvAt: i64 = Date.now();
      try { appendFile(MAILBOX, `${recvAt}` + "|" + line + "\n"); } catch { }
      count = count + 1;
    }
  }
  sock.close();
  return count;
}

let mailboxSeen: int = 0;

function nonEmptyLines(content: string): string[] {
  let raw = content.split("\n");
  let out: string[] = [];
  let i: int = 0;
  while (i < raw.length) {
    if (raw[i] != "") { out.push(raw[i]); }
    i = i + 1;
  }
  return out;
}

function drainMailbox(label: string): void {
  let content = fs.readFileSync(MAILBOX);
  let lines = nonEmptyLines(content);
  let i: int = mailboxSeen;
  while (i < lines.length) {
    let observedAt: i64 = Date.now();
    let bar = lines[i].indexOf("|");
    let recvAt: i64 = parseI64(lines[i].slice(0, bar));
    let frame = lines[i].slice(bar + 1, lines[i].length);
    let latency: i64 = observedAt - recvAt;
    console.log("main: observed [" + frame + "] during [" + label + "] recv_at=" + `${recvAt}` + " observed_at=" + `${observedAt}` + " latency_ms=" + `${latency}`);
    i = i + 1;
  }
  mailboxSeen = lines.length;
}

async function main(): Promise<void> {
  fs.writeFileSync(MAILBOX, "");
  console.log("main: spawning worker receive loop against fake relay at " + RELAY_HOST + ":" + `${RELAY_PORT}`);
  let workerPromise = Worker.run(receiveLoop);

  console.log("main: opening http.stream to " + HTTP_URL);
  let headers = new Map<string, string>();
  let stream = http.stream(HTTP_URL, "GET", "", headers);
  console.log("main: http status " + `${stream.status()}`);
  while (!stream.done()) {
    let before: i64 = Date.now();
    let line = stream.readLine();
    let after: i64 = Date.now();
    if (stream.done()) { break; }
    console.log("main: http chunk observed at " + `${after}` + " blocked_ms=" + `${after - before}` + " line=[" + line + "]");
    drainMailbox("blocked on http.stream");
  }
  stream.close();

  console.log("main: spawning child process dripper");
  let args: string[] = ["-c", "for i in 1 2 3 4; do echo child-line-$i; sleep 1; done"];
  let cp = child_process.spawn("sh", args);
  while (true) {
    let before: i64 = Date.now();
    let line = cp.readLine();
    let after: i64 = Date.now();
    if (line == "") { break; }
    console.log("main: child line observed at " + `${after}` + " blocked_ms=" + `${after - before}` + " line=[" + line + "]");
    drainMailbox("blocked on child process");
  }
  cp.close();

  let total = await workerPromise;
  drainMailbox("final drain");
  console.log("main: worker receive loop finished, frames=" + `${total}`);
}

main();
