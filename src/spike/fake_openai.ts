const PORT: int = 8478;

function writeLine(res: ResponseWriter, s: string): void {
  res.write(s + "\n");
}

function serveTurn1(res: ResponseWriter): void {
  process.sleep(300);
  writeLine(res, "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"run\",\"arguments\":\"\"}}]},\"finish_reason\":null}]}");
  process.sleep(300);
  writeLine(res, "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"command\\\":\"}}]},\"finish_reason\":null}]}");
  process.sleep(300);
  writeLine(res, "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"echo subagent-tool-ran\\\"}\"}}]},\"finish_reason\":null}]}");
  process.sleep(300);
  writeLine(res, "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}");
  writeLine(res, "data: [DONE]");
}

function serveTurn2(res: ResponseWriter): void {
  process.sleep(300);
  writeLine(res, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Background subagent finished: the run tool executed and reported success.\"},\"finish_reason\":null}]}");
  process.sleep(300);
  writeLine(res, "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}");
  writeLine(res, "data: [DONE]");
}

function handle(req: HttpRequest, res: ResponseWriter): void {
  let headers = new Map<string, string>();
  headers.set("Content-Type", "text/event-stream");
  res.writeHead(200, headers);
  if (req.path == "/t1/v1/chat/completions") {
    serveTurn1(res);
  } else {
    serveTurn2(res);
  }
  res.end();
}

console.log("fake_openai: listening on :" + `${PORT}`);
http.createServer(PORT, handle);
