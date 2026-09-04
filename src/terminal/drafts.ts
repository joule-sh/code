export class Drafts {
  names: string[];
  texts: string[];

  constructor() {
    this.names = [];
    this.texts = [];
  }

  indexOf(name: string): int {
    let i = 0;
    while (i < this.names.length) {
      if (this.names[i] == name) { return i; }
      i = i + 1;
    }
    return -1;
  }

  save(name: string, text: string): void {
    let at = this.indexOf(name);
    if (at >= 0) {
      this.texts = [...this.texts.slice(0, at), text, ...this.texts.slice(at + 1, this.texts.length)];
      return;
    }
    this.names.push(name);
    this.texts.push(text);
  }

  load(name: string): string {
    let at = this.indexOf(name);
    if (at < 0) { return ""; }
    return this.texts[at];
  }

  clear(name: string): void {
    this.save(name, "");
  }
}

test("a session never visited has an empty draft", () => {
  let d = new Drafts();
  expect(d.load("review") == "");
});

test("a saved draft comes back for its own session and no other", () => {
  let d = new Drafts();
  d.save("", "half a thought");
  expect(d.load("") == "half a thought");
  expect(d.load("review") == "");
});

test("saving twice for one session replaces rather than appends", () => {
  let d = new Drafts();
  d.save("review", "first");
  d.save("review", "second");
  expect(d.load("review") == "second");
  expect(d.names.length == 1);
});

test("drafts for several sessions stay separate across switches back and forth", () => {
  let d = new Drafts();
  d.save("", "default text");
  d.save("review", "review text");
  d.save("planning", "planning text");
  expect(d.load("") == "default text");
  expect(d.load("review") == "review text");
  expect(d.load("planning") == "planning text");
});

test("clearing a draft leaves the session known but empty", () => {
  let d = new Drafts();
  d.save("review", "sent already");
  d.clear("review");
  expect(d.load("review") == "");
  expect(d.indexOf("review") >= 0);
});
