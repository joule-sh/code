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

  if (candidate == rootReal) {
    return allowed(candidate);
  }
  if (candidate.startsWith(rootReal + "/")) {
    return allowed(candidate);
  }
  return refused();
}
