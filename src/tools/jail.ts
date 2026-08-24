export type JailResult = { path: string, ok: bool };

function resolveExistingAncestor(p: string): string {
  let cur = p;
  let guard = 0;
  while (!fs.existsSync(cur) && guard < 64) {
    let parent = path.dirname(cur);
    if (parent == cur || parent == "") {
      return cur;
    }
    cur = parent;
    guard = guard + 1;
  }
  return cur;
}

function refused(): JailResult {
  return { path: "", ok: false };
}

function allowed(p: string): JailResult {
  return { path: p, ok: true };
}

export function jail(root: string, relPath: string): JailResult {
  let rootReal = fs.realpathSync(root);
  let target = path.join(root, relPath);
  let existingAncestor = resolveExistingAncestor(target);
  let ancestorReal = fs.realpathSync(existingAncestor);
  let remainder = target.slice(existingAncestor.length);
  let candidate = ancestorReal + remainder;

  if (isWithin(candidate, rootReal)) {
    return allowed(candidate);
  }
  return refused();
}

// Windows answers realpath and path.join in backslashes, so a candidate under
// the root read as escaping it and every file tool refused every path (#173).
// Both separators are accepted rather than normalised, because the string that
// comes back from here is handed straight to fs and has to stay the spelling
// the platform gave.
export function isWithin(candidate: string, rootReal: string): bool {
  if (candidate == rootReal) { return true; }
  if (candidate.startsWith(rootReal + "/")) { return true; }
  return candidate.startsWith(rootReal + "\\");
}
