import { Frame, Assembly, OP_CLOSE, OP_PING, OP_PONG, decodeFrame, addFrame, closeCodeOf } from "./frame.ts";

export const STEP_WAIT: int = 0;
export const STEP_MESSAGE: int = 1;
export const STEP_PONG: int = 2;
export const STEP_CLOSE: int = 3;
export const STEP_FAIL: int = 4;

export type Step = {
  what: int,
  opcode: int,
  message: string,
  code: int,
  error: string,
  buffer: string,
  assembly: Assembly,
};

export function drain(buffer: string, assembly: Assembly, max: int, expectMask: bool): Step {
  let rest = buffer;
  let state = assembly;

  while (true) {
    let frame = decodeFrame(rest, max);
    if (frame.error != "") { return fail(frame.error, rest, state); }
    if (!frame.complete) { return waiting(rest, state); }
    if (frame.masked != expectMask) {
      if (expectMask) { return fail("a client frame must be masked", rest, state); }
      return fail("a server frame must not be masked", rest, state);
    }
    rest = rest.slice(frame.consumed, rest.length);

    state = addFrame(state, frame);
    if (state.error != "") { return fail(state.error, rest, state); }
    if (!state.ready) { continue; }

    if (state.opcode == OP_CLOSE) {
      let bye: Step = {
        what: STEP_CLOSE, opcode: OP_CLOSE, message: state.message,
        code: closeCodeOf(state.message), error: "", buffer: rest, assembly: state,
      };
      return bye;
    }
    if (state.opcode == OP_PING) {
      let pong: Step = {
        what: STEP_PONG, opcode: OP_PING, message: state.message,
        code: 0, error: "", buffer: rest, assembly: state,
      };
      return pong;
    }
    if (state.opcode == OP_PONG) { continue; }

    let out: Step = {
      what: STEP_MESSAGE, opcode: state.opcode, message: state.message,
      code: 0, error: "", buffer: rest, assembly: state,
    };
    return out;
  }
  return waiting(rest, state);
}

function waiting(rest: string, state: Assembly): Step {
  let s: Step = { what: STEP_WAIT, opcode: 0, message: "", code: 0, error: "", buffer: rest, assembly: state };
  return s;
}

function fail(why: string, rest: string, state: Assembly): Step {
  let s: Step = { what: STEP_FAIL, opcode: 0, message: "", code: 0, error: why, buffer: rest, assembly: state };
  return s;
}
