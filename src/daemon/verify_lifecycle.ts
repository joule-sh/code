import { readDaemonInfo, writeDaemonInfo, removeDaemonInfo, daemonInfoPath, daemonBinaryArgs } from "./lifecycle.ts";

writeDaemonInfo("/tmp/some-workspace", 8199);
let info = readDaemonInfo("/tmp/some-workspace");
if (info != null) {
  console.log("wrote and read back: port=" + `${info.port}` + " workspace=" + info.workspace);
}
console.log("info path: " + daemonInfoPath("/tmp/some-workspace"));
let args = daemonBinaryArgs("/tmp/some-workspace", 8199);
console.log("spawn args: " + args.join(" "));
removeDaemonInfo("/tmp/some-workspace");
let gone = readDaemonInfo("/tmp/some-workspace");
console.log("after removal, info is null: " + `${gone == null}`);
