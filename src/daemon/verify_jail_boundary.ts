import { dispatchCoreTool } from "../tools/dispatch.ts";
import { jail } from "../tools/jail.ts";

type ReadArgs = { path: string };

fs.mkdirSync("/tmp/jail-check-workspace", true);
fs.writeFileSync("/tmp/jail-check-workspace/inside.txt", "inside content");
fs.writeFileSync("/tmp/jail-check-outside-secret.txt", "OUTSIDE SECRET, must never be readable");

let root = "/tmp/jail-check-workspace";

console.log("--- direct jail() calls ---");
let insideResult = jail(root, "inside.txt");
console.log("jail(root, 'inside.txt') ok=" + `${insideResult.ok}` + " path=" + insideResult.path);

let traversal = jail(root, "../jail-check-outside-secret.txt");
console.log("jail(root, '../jail-check-outside-secret.txt') ok=" + `${traversal.ok}`);

let deepTraversal = jail(root, "../../../../../../etc/passwd");
console.log("jail(root, '../../../../../../etc/passwd') ok=" + `${deepTraversal.ok}`);

console.log("--- via dispatchCoreTool (what the model's read tool actually calls) ---");
let argsInside: ReadArgs = { path: "inside.txt" };
let readInside = dispatchCoreTool(root, "read", JSON.stringify(argsInside));
console.log("read inside.txt: ok=" + `${readInside.ok}` + " output=" + readInside.output.slice(0, 50));

let argsOutside: ReadArgs = { path: "../jail-check-outside-secret.txt" };
let readOutside = dispatchCoreTool(root, "read", JSON.stringify(argsOutside));
console.log("read ../jail-check-outside-secret.txt: ok=" + `${readOutside.ok}` + " output=" + readOutside.output);

let argsAbs: ReadArgs = { path: "/tmp/jail-check-outside-secret.txt" };
let readAbs = dispatchCoreTool(root, "read", JSON.stringify(argsAbs));
console.log("read /tmp/jail-check-outside-secret.txt (absolute path): ok=" + `${readAbs.ok}` + " output=" + readAbs.output);
