const ESC: string = String.fromCharCode(27);
const BEL: string = String.fromCharCode(7);
const ALPHABET: string = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export const OSC52_MAX_BYTES: int = 74994;

export function base64Encode(data: string): string {
  let out = "";
  let i = 0;
  while (i + 2 < data.length) {
    let n = (data.charCodeAt(i) << 16) + (data.charCodeAt(i + 1) << 8) + data.charCodeAt(i + 2);
    out = out + ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63)
      + ALPHABET.charAt((n >> 6) & 63) + ALPHABET.charAt(n & 63);
    i = i + 3;
  }
  let left = data.length - i;
  if (left == 1) {
    let n = data.charCodeAt(i) << 16;
    out = out + ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63) + "==";
  } else if (left == 2) {
    let n = (data.charCodeAt(i) << 16) + (data.charCodeAt(i + 1) << 8);
    out = out + ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63)
      + ALPHABET.charAt((n >> 6) & 63) + "=";
  }
  return out;
}

export function clipboardPayload(text: string): string {
  if (text.length <= OSC52_MAX_BYTES) { return text; }
  return text.slice(0, OSC52_MAX_BYTES);
}

export function osc52Sequence(text: string): string {
  return ESC + "]52;c;" + base64Encode(clipboardPayload(text)) + BEL;
}

export function writeClipboard(text: string): void {
  if (text == "") { return; }
  process.stdout().write(osc52Sequence(text));
}
