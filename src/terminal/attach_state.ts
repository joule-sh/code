export class ClientState {
  model: string;
  turnId: string;
  stopReason: string;

  constructor(model: string) {
    this.model = model;
    this.turnId = "";
    this.stopReason = "";
  }
}

export class CommandOutcome {
  leave: bool;
  switchTarget: string;
  renameTarget: string;

  constructor() {
    this.leave = false;
    this.switchTarget = "";
    this.renameTarget = "";
  }

  leaveFor(target: string): void {
    this.switchTarget = target;
    this.leave = true;
  }

  renameTo(target: string): void {
    this.renameTarget = target;
    this.leave = true;
  }
}

test("a fresh outcome neither leaves nor names a target", () => {
  let o = new CommandOutcome();
  expect(!o.leave);
  expect(o.switchTarget == "");
  expect(o.renameTarget == "");
});

test("leaving for a session records the target and asks the loop to end", () => {
  let o = new CommandOutcome();
  o.leaveFor("review");
  expect(o.leave);
  expect(o.switchTarget == "review");
  expect(o.renameTarget == "");
});

test("renaming records the new name and asks the loop to end", () => {
  let o = new CommandOutcome();
  o.renameTo("planning");
  expect(o.leave);
  expect(o.renameTarget == "planning");
  expect(o.switchTarget == "");
});

test("a client state starts on the model it was given with no turn in flight", () => {
  let s = new ClientState("gpt");
  expect(s.model == "gpt");
  expect(s.turnId == "");
  expect(s.stopReason == "");
});
