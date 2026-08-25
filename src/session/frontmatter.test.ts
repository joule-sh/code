import { parseFrontmatter, fieldValue, hasFieldKey } from "./frontmatter.ts";

test("a file with no frontmatter is read as all body, not as an error", () => {
  let f = parseFrontmatter("just some instructions");
  expect(f.ok);
  expect(f.fields.length == 0);
  expect(f.body == "just some instructions");
});

test("name and description are read out of a well-formed block", () => {
  let f = parseFrontmatter("---\nname: deploy\ndescription: use when shipping a release\n---\nstep one");
  expect(f.ok);
  expect(fieldValue(f.fields, "name") == "deploy");
  expect(fieldValue(f.fields, "description") == "use when shipping a release");
  expect(f.body == "step one");
});

test("keys are matched case-insensitively and quoted values are unwrapped", () => {
  let f = parseFrontmatter("---\nName: \"deploy\"\nDESCRIPTION: 'ship it'\n---\nbody");
  expect(fieldValue(f.fields, "name") == "deploy");
  expect(fieldValue(f.fields, "description") == "ship it");
});

test("frontmatter written for another tool is read leniently: unknown keys are kept, list items and comments are skipped", () => {
  let f = parseFrontmatter("---\nname: review\ndescription: check a diff\n# a comment\nallowed-tools:\n  - Bash\n  - Read\nlicense: MIT\n---\nbody");
  expect(f.ok);
  expect(fieldValue(f.fields, "name") == "review");
  expect(fieldValue(f.fields, "license") == "MIT");
  expect(hasFieldKey(f.fields, "allowed-tools"));
});

test("an unclosed frontmatter block fails loudly instead of being guessed at", () => {
  let f = parseFrontmatter("---\nname: broken\ndescription: no end fence");
  expect(!f.ok);
  expect(f.error.indexOf("closing") >= 0);
});

test("a line inside the block that is not key: value fails loudly and names the line", () => {
  let f = parseFrontmatter("---\nname: broken\nthis line makes no sense\n---\nbody");
  expect(!f.ok);
  expect(f.error.indexOf("this line makes no sense") >= 0);
});

test("carriage returns from a file written on another platform do not break parsing", () => {
  let f = parseFrontmatter("---\r\nname: deploy\r\ndescription: ship\r\n---\r\nbody");
  expect(f.ok);
  expect(fieldValue(f.fields, "name") == "deploy");
  expect(fieldValue(f.fields, "description") == "ship");
});

test("a value containing a colon keeps everything after the first one", () => {
  let f = parseFrontmatter("---\nname: x\ndescription: use when the url is http://example.com\n---\nb");
  expect(fieldValue(f.fields, "description") == "use when the url is http://example.com");
});

test("fieldValue returns empty for a key that is not there", () => {
  let f = parseFrontmatter("---\nname: x\ndescription: y\n---\nb");
  expect(fieldValue(f.fields, "nope") == "");
  expect(!hasFieldKey(f.fields, "nope"));
});
