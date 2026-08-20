export const OP_CONTINUATION: int = 0;
export const OP_TEXT: int = 1;
export const OP_BINARY: int = 2;
export const OP_CLOSE: int = 8;
export const OP_PING: int = 9;
export const OP_PONG: int = 10;

export const CLOSE_NORMAL: int = 1000;
export const CLOSE_PROTOCOL_ERROR: int = 1002;
export const CLOSE_TOO_LARGE: int = 1009;

export type Frame = {
  complete: bool,
  fin: bool,
  opcode: int,
  payload: string,
  consumed: int,
  masked: bool,
  error: string,
};

export function encodeFrame(opcode: int, payload: string, mask: bool, maskKey: string): string {
  let first = 128 + opcode;
  let out = String.fromCharCode(first);
  let n = payload.length;

  let maskBit: int = 0;
  if (mask) { maskBit = 128; }

  if (n < 126) {
    out = out + String.fromCharCode(maskBit + n);
  } else if (n < 65536) {
    out = out + String.fromCharCode(maskBit + 126)
      + String.fromCharCode((n / 256) % 256) + String.fromCharCode(n % 256);
  } else {
    out = out + String.fromCharCode(maskBit + 127)
      + String.fromCharCode(0) + String.fromCharCode(0)
      + String.fromCharCode(0) + String.fromCharCode(0)
      + String.fromCharCode((n / 16777216) % 256)
      + String.fromCharCode((n / 65536) % 256)
      + String.fromCharCode((n / 256) % 256)
      + String.fromCharCode(n % 256);
  }

  if (!mask) { return out + payload; }
  let key = maskKey;
  if (key.length != 4) { key = String.fromCharCode(0) + String.fromCharCode(0) + String.fromCharCode(0) + String.fromCharCode(0); }
  return out + key + applyMask(payload, key);
}

export function applyMask(payload: string, key: string): string {
  if (key.length != 4) { return payload; }
  let out = "";
  let i: int = 0;
  while (i < payload.length) {
    let b = payload.charCodeAt(i);
    let k = key.charCodeAt(i % 4);
    out = out + String.fromCharCode(xorByte(b, k));
    i = i + 1;
  }
  return out;
}

function xorByte(a: int, b: int): int {
  let out: int = 0;
  let bit: int = 1;
  let x = a;
  let y = b;
  let i: int = 0;
  while (i < 8) {
    let ax = x % 2;
    let by = y % 2;
    if (ax != by) { out = out + bit; }
    x = x / 2;
    y = y / 2;
    bit = bit * 2;
    i = i + 1;
  }
  return out;
}

export function encodeClose(code: int, reason: string, mask: bool, maskKey: string): string {
  let body = String.fromCharCode((code / 256) % 256) + String.fromCharCode(code % 256) + reason;
  return encodeFrame(OP_CLOSE, body, mask, maskKey);
}

export function closeCodeOf(payload: string): int {
  if (payload.length < 2) { return 1005; }
  return payload.charCodeAt(0) * 256 + payload.charCodeAt(1);
}

export function decodeFrame(buffer: string, maxPayload: int): Frame {
  let partial: Frame = { complete: false, fin: false, opcode: 0, payload: "", consumed: 0, masked: false, error: "" };
  if (buffer.length < 2) { return partial; }

  let b0 = buffer.charCodeAt(0);
  let b1 = buffer.charCodeAt(1);
  let fin = b0 >= 128;
  let opcode = b0 % 16;
  let masked = b1 >= 128;
  let len = b1 % 128;

  let at: int = 2;
  if (len == 126) {
    if (buffer.length < 4) { return partial; }
    len = buffer.charCodeAt(2) * 256 + buffer.charCodeAt(3);
    at = 4;
  } else if (len == 127) {
    if (buffer.length < 10) { return partial; }
    if (buffer.charCodeAt(2) != 0 || buffer.charCodeAt(3) != 0
        || buffer.charCodeAt(4) != 0 || buffer.charCodeAt(5) != 0) {
      let vast: Frame = { complete: false, fin: false, opcode: 0, payload: "", consumed: 0, masked: false,
        error: "a frame larger than 4 GB is refused" };
      return vast;
    }
    len = buffer.charCodeAt(6) * 16777216 + buffer.charCodeAt(7) * 65536
      + buffer.charCodeAt(8) * 256 + buffer.charCodeAt(9);
    at = 10;
  }

  if (maxPayload > 0 && len > maxPayload) {
    let big: Frame = { complete: false, fin: false, opcode: 0, payload: "", consumed: 0, masked: false,
      error: "frame of " + `${len}` + " bytes is over the limit of " + `${maxPayload}` };
    return big;
  }

  if (opcode >= 8) {
    if (len > 125) {
      let bad: Frame = { complete: false, fin: false, opcode: opcode, payload: "", consumed: 0, masked: false,
        error: "a control frame carries at most 125 bytes" };
      return bad;
    }
    if (!fin) {
      let split: Frame = { complete: false, fin: false, opcode: opcode, payload: "", consumed: 0, masked: false,
        error: "a control frame is never fragmented" };
      return split;
    }
  }

  let key = "";
  if (masked) {
    if (buffer.length < at + 4) { return partial; }
    key = buffer.slice(at, at + 4);
    at = at + 4;
  }

  if (buffer.length < at + len) { return partial; }
  let body = buffer.slice(at, at + len);
  if (masked) { body = applyMask(body, key); }

  let out: Frame = {
    complete: true, fin: fin, opcode: opcode, payload: body,
    consumed: at + len, masked: masked, error: "",
  };
  return out;
}

export type Assembly = {
  ready: bool,
  opcode: int,
  message: string,
  pending: string,
  pendingOpcode: int,
  error: string,
};

export function newAssembly(): Assembly {
  let a: Assembly = { ready: false, opcode: 0, message: "", pending: "", pendingOpcode: 0, error: "" };
  return a;
}

export function addFrame(state: Assembly, frame: Frame): Assembly {
  if (frame.opcode >= 8) {
    let control: Assembly = {
      ready: true, opcode: frame.opcode, message: frame.payload,
      pending: state.pending, pendingOpcode: state.pendingOpcode, error: "",
    };
    return control;
  }

  if (frame.opcode == OP_CONTINUATION) {
    if (state.pendingOpcode == 0) {
      let orphan: Assembly = {
        ready: false, opcode: 0, message: "", pending: "", pendingOpcode: 0,
        error: "a continuation frame with nothing to continue",
      };
      return orphan;
    }
    let joined = state.pending + frame.payload;
    if (!frame.fin) {
      let more: Assembly = { ready: false, opcode: 0, message: "", pending: joined, pendingOpcode: state.pendingOpcode, error: "" };
      return more;
    }
    let done: Assembly = { ready: true, opcode: state.pendingOpcode, message: joined, pending: "", pendingOpcode: 0, error: "" };
    return done;
  }

  if (state.pendingOpcode != 0) {
    let interleaved: Assembly = {
      ready: false, opcode: 0, message: "", pending: "", pendingOpcode: 0,
      error: "a new message began before the last one finished",
    };
    return interleaved;
  }

  if (frame.fin) {
    let whole: Assembly = { ready: true, opcode: frame.opcode, message: frame.payload, pending: "", pendingOpcode: 0, error: "" };
    return whole;
  }
  let started: Assembly = { ready: false, opcode: 0, message: "", pending: frame.payload, pendingOpcode: frame.opcode, error: "" };
  return started;
}
