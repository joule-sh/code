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

// PowerShell's single-quoted string, where the only escape is a doubled quote
// and a backslash is an ordinary character - which is what makes it the right
// wrapper for a Windows path.
export function powershellQuoteSingle(s: string): string {
  let out = "'";
  let i: int = 0;
  while (i < s.length) {
    let c = s.charAt(i);
    if (c == "'") {
      out = out + "''";
    } else {
      out = out + c;
    }
    i = i + 1;
  }
  return out + "'";
}
