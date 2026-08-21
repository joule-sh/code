export function shellQuoteSingle(s: string): string {
  let out = "'";
  let i: int = 0;
  while (i < s.length) {
    let c = s.charAt(i);
    if (c == "'") {
      out = out + "'\\''";
    } else {
      out = out + c;
    }
    i = i + 1;
  }
  return out + "'";
}
