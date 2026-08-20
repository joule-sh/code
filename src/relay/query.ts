export type SplitPath = { pathname: string, query: string };

export function splitPathAndQuery(path: string): SplitPath {
  let at = path.indexOf("?");
  if (at < 0) {
    let whole: SplitPath = { pathname: path, query: "" };
    return whole;
  }
  let out: SplitPath = { pathname: path.slice(0, at), query: path.slice(at + 1, path.length) };
  return out;
}

export function queryParam(query: string, name: string): string {
  if (query == "") { return ""; }
  let pairs = query.split("&");
  let i: int = 0;
  while (i < pairs.length) {
    let pair = pairs[i];
    let eq = pair.indexOf("=");
    let key = pair;
    let rawValue = "";
    if (eq >= 0) {
      key = pair.slice(0, eq);
      rawValue = pair.slice(eq + 1, pair.length);
    }
    if (decodeURIComponent(key) == name) {
      return decodeURIComponent(rawValue);
    }
    i = i + 1;
  }
  return "";
}
