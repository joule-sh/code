import http from "node:http";

// A stand-in for the console's /terminal/verify: knows exactly one real
// credential secret, everything else is refused. This is the seam
// account_verify.ts's relay side calls out to, and a relay that has no
// console to ask attributes nothing - so every harness whose terminal signs
// in needs one of these, or its share is anonymous the way joule-sh/code#279
// came back for.
export function startConsoleStub(knownSecret, account) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/terminal/verify") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { parsed = null; }
        if (parsed && parsed.secret === knownSecret) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ account }));
          return;
        }
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "revoked" }));
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}
