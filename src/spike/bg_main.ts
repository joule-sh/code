import { configureBackgroundRun, backgroundRunLoop, configureSubagent, subagentLoop } from "./bg_worker.ts";
import { MailboxReader } from "./mailbox.ts";

const RUN_MAILBOX: string = "/tmp/joule-bgtask-run-mailbox.log";
const AGENT_MAILBOX: string = "/tmp/joule-bgtask-agent-mailbox.log";
const AGENT_BASE: string = "http://127.0.0.1:8478";

function runForegroundChild(label: string, script: string, reader: MailboxReader): void {
  let args: string[] = ["-c", script];
  let cp = child_process.spawn("sh", args);
  while (true) {
    let before: i64 = Date.now();
    let line = cp.readLine();
    let after: i64 = Date.now();
    if (line == "") { break; }
    console.log("main: " + label + " observed at " + `${after}` + " blocked_ms=" + `${after - before}` + " line=[" + line + "]");
    reader.drain(label);
  }
  cp.close();
}

async function main(): Promise<void> {
  fs.writeFileSync(RUN_MAILBOX, "");
  let runReader = new MailboxReader(RUN_MAILBOX);
  console.log("main: t=" + `${Date.now()}` + " spawning background run worker (a 6-tick, 6s shell loop)");
  configureBackgroundRun("for i in 1 2 3 4 5 6; do echo bg-run-tick-$i; sleep 1; done", RUN_MAILBOX);
  let runPromise = Worker.run(backgroundRunLoop);

  console.log("main: t=" + `${Date.now()}` + " starting foreground turn 1 while the background run is (hopefully) in flight");
  runForegroundChild("foreground turn 1", "for i in 1 2; do echo fg-turn1-tick-$i; sleep 1; done", runReader);

  console.log("main: t=" + `${Date.now()}` + " foreground turn 1 done, starting foreground turn 2");
  runForegroundChild("foreground turn 2", "for i in 1 2; do echo fg-turn2-tick-$i; sleep 1; done", runReader);

  let totalLines = await runPromise;
  runReader.drain("final drain, phase A");
  console.log("main: t=" + `${Date.now()}` + " background run worker finished, lines=" + `${totalLines}`);

  fs.writeFileSync(AGENT_MAILBOX, "");
  let agentReader = new MailboxReader(AGENT_MAILBOX);
  configureSubagent(AGENT_BASE + "/t1", AGENT_BASE + "/t2", "fake-model", "Run a command that proves you can act, then summarize what happened.", process.cwd(), AGENT_MAILBOX);
  console.log("main: t=" + `${Date.now()}` + " spawning background subagent worker");
  let agentPromise = Worker.run(subagentLoop);

  console.log("main: t=" + `${Date.now()}` + " starting foreground turn 3 while the subagent is (hopefully) streaming");
  runForegroundChild("foreground turn 3", "for i in 1 2 3; do echo fg-turn3-tick-$i; sleep 1; done", agentReader);

  let steps = await agentPromise;
  agentReader.drain("final drain, phase B");
  console.log("main: t=" + `${Date.now()}` + " background subagent finished, steps=" + `${steps}`);
}

main();
