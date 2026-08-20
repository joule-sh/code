const PORT: int = 8475;
const FRAME_COUNT: int = 6;
const FRAME_INTERVAL_MS: int = 400;

function handleConn(sock: Socket): void {
  let i: int = 0;
  while (i < FRAME_COUNT) {
    process.sleep(FRAME_INTERVAL_MS);
    let sentAt: i64 = Date.now();
    let frame = "frame-" + `${i}` + " sent=" + `${sentAt}`;
    sock.write(frame + "\n");
    console.log("fake_relay: sent " + frame);
    i = i + 1;
  }
  sock.write("END\n");
  sock.close();
}

console.log("fake_relay: listening on :" + `${PORT}`);
net.createServer(PORT, handleConn);
