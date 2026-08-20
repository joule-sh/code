export const CODE_ALPHABET: string = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH: int = 6;
export const SECRET_BYTE_LENGTH: int = 32;

function hexNibble(ch: string): int {
  let c = ch.charCodeAt(0);
  if (c >= 48 && c <= 57) { return c - 48; }
  if (c >= 97 && c <= 102) { return c - 87; }
  if (c >= 65 && c <= 70) { return c - 55; }
  return 0;
}

function hexByteAt(hex: string, i: int): int {
  let hi = hexNibble(hex.charAt(i * 2));
  let lo = hexNibble(hex.charAt(i * 2 + 1));
  return hi * 16 + lo;
}

export function codeFromRandomHex(hex: string): string {
  let out = "";
  let i: int = 0;
  while (out.length < CODE_LENGTH && (i * 2 + 1) < hex.length) {
    let b = hexByteAt(hex, i);
    out = out + CODE_ALPHABET.charAt(b % CODE_ALPHABET.length);
    i = i + 1;
  }
  return out;
}

export function generateCode(): string {
  return codeFromRandomHex(crypto.randomBytes(CODE_LENGTH));
}

export function generateSecret(): string {
  return crypto.randomBytes(SECRET_BYTE_LENGTH);
}

export function generateSessionId(): string {
  return crypto.randomUUID();
}

export function constantTimeEqual(candidate: string, stored: string): bool {
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(stored));
}
