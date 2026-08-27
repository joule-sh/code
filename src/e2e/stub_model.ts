import { scriptedResponseBodyFor } from "./stub_script.ts";
import { chunkedSseResponse, badRequestResponse, readStubRequest } from "./stub_http.ts";
import { requestContractProblem } from "./stub_contract.ts";
import { appendFile, envOr } from "../vendor/platform/platform.ts";

function envInt(name: string, fallback: int): int {
  let raw = envOr(name, "");
  return Number.parseInt(raw, 10) ?? fallback;
}

const PORT: int = envInt("E2E_STUB_PORT", 0);
const LOG_PATH: string = envOr("E2E_STUB_LOG", "");
const SCRIPT: string = envOr("E2E_STUB_SCRIPT", "");

let requestCount: int = 0;

function logRequest(body: string): void {
  if (LOG_PATH == "") { return; }
  appendFile(LOG_PATH, body + "\n<<<END>>>\n");
}

function handleConnection(socket: Socket): void {
  let parsed = readStubRequest(socket);
  if (!parsed.ok) {
    socket.close();
    return;
  }
  logRequest(parsed.body);
  let problem = requestContractProblem(parsed.body);
  if (problem != "") {
    logRequest("<<<CONTRACT REFUSED>>> " + problem);
    socket.write(badRequestResponse(problem));
    socket.close();
    return;
  }
  let step = requestCount;
  requestCount = requestCount + 1;
  socket.write(chunkedSseResponse(scriptedResponseBodyFor(SCRIPT, step)));
  socket.close();
}

function runStubModel(): void {
  console.log("stub_model: serving on :" + `${PORT}`);
  net.createServer(PORT, (socket: Socket) => { handleConnection(socket); });
  return;
}

runStubModel();

test("envInt falls back when the variable is unset", () => {
  expect(envInt("E2E_STUB_PORT_NOPE", 4321) == 4321);
});
