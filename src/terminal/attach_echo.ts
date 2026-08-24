export class LocalPrompts {
  sent: string[];

  constructor() {
    this.sent = [];
  }

  note(text: string): void {
    this.sent.push(text);
  }

  pending(): int {
    return this.sent.length;
  }

  claim(text: string): bool {
    if (this.sent.length == 0) { return false; }
    if (this.sent[0] != text) { return false; }
    this.sent = this.sent.slice(1, this.sent.length);
    return true;
  }
}

test("a prompt this client never sent is not claimed, so the transcript draws it", () => {
  let echoes = new LocalPrompts();
  expect(!echoes.claim("what does the daemon do"));
});

test("the prompt this client echoed itself is claimed exactly once", () => {
  let echoes = new LocalPrompts();
  echoes.note("fix the health route");
  expect(echoes.claim("fix the health route"));
  expect(!echoes.claim("fix the health route"));
});

test("prompts are claimed in the order they were sent", () => {
  let echoes = new LocalPrompts();
  echoes.note("first");
  echoes.note("second");
  expect(!echoes.claim("second"));
  expect(echoes.claim("first"));
  expect(echoes.claim("second"));
  expect(echoes.pending() == 0);
});

test("a prompt from another client leaves this client's own echo waiting", () => {
  let echoes = new LocalPrompts();
  echoes.note("mine");
  expect(!echoes.claim("theirs"));
  expect(echoes.pending() == 1);
  expect(echoes.claim("mine"));
});
