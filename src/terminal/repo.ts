const REF_PREFIX: string = "ref: ";
const URL_KEY: string = "url = ";
const GIT_SUFFIX: string = ".git";
const SHORT_SHA: int = 7;

export function baseName(pathText: string): string {
  let p = pathText;
  while (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, p.length - 1);
  }
  let at = p.lastIndexOf("/");
  if (at >= 0) { return p.slice(at + 1, p.length); }
  return p;
}

function segments(text: string): string[] {
  let out: string[] = [];
  let cur = "";
  let i = 0;
  while (i < text.length) {
    let ch = text.charAt(i);
    if (ch == "/" || ch == ":") {
      if (cur != "") { out.push(cur); }
      cur = "";
    } else {
      cur = cur + ch;
    }
    i = i + 1;
  }
  if (cur != "") { out.push(cur); }
  return out;
}

export function slugFromUrl(url: string): string {
  let u = url.trim();
  if (u.endsWith(GIT_SUFFIX)) { u = u.slice(0, u.length - GIT_SUFFIX.length); }
  let parts = segments(u);
  if (parts.length == 0) { return ""; }
  if (parts.length == 1) { return parts[0]; }
  return parts[parts.length - 2] + "/" + parts[parts.length - 1];
}

export function parseHeadRef(head: string): string {
  let line = head.trim();
  if (line.startsWith(REF_PREFIX)) {
    let ref = line.slice(REF_PREFIX.length, line.length).trim();
    let at = ref.lastIndexOf("/");
    if (at >= 0) { return ref.slice(at + 1, ref.length); }
    return ref;
  }
  if (line.length >= SHORT_SHA) { return line.slice(0, SHORT_SHA); }
  return "";
}

export function parseRemoteSlug(config: string): string {
  let lines = config.split("\n");
  let i = 0;
  while (i < lines.length) {
    let line = lines[i].trim();
    if (line.startsWith(URL_KEY)) {
      return slugFromUrl(line.slice(URL_KEY.length, line.length));
    }
    i = i + 1;
  }
  return "";
}

export function describeRepo(slug: string, branch: string): string {
  if (slug == "") { return ""; }
  if (branch == "") { return slug; }
  return slug + " on " + branch;
}

function readIfPresent(filePath: string): string {
  if (!fs.existsSync(filePath)) { return ""; }
  let out = "";
  try { out = fs.readFileSync(filePath); } catch { return ""; }
  return out;
}

export function repoSummary(workspace: string): string {
  let gitDir = workspace + "/.git";
  let head = readIfPresent(gitDir + "/HEAD");
  if (head == "") { return ""; }
  let slug = parseRemoteSlug(readIfPresent(gitDir + "/config"));
  if (slug == "") { slug = baseName(workspace); }
  return describeRepo(slug, parseHeadRef(head));
}
