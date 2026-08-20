const PORT: int = 8476;
const CHUNK_COUNT: int = 4;
const CHUNK_INTERVAL_MS: int = 1000;

function handle(req: HttpRequest, res: ResponseWriter): void {
  let headers = new Map<string, string>();
  headers.set("Content-Type", "text/event-stream");
  res.writeHead(200, headers);
  let i: int = 0;
  while (i < CHUNK_COUNT) {
    process.sleep(CHUNK_INTERVAL_MS);
    let sentAt: i64 = Date.now();
    let line = "data: chunk-" + `${i}` + " sent=" + `${sentAt}`;
    res.write(line + "\n");
    console.log("slow_http: sent " + line);
    i = i + 1;
  }
  res.end();
}

console.log("slow_http: listening on :" + `${PORT}`);
http.createServer(PORT, handle);
