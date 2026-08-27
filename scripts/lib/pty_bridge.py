#!/usr/bin/env python3
# Runs a command on a real pty and bridges it to plain pipes, so a node
# harness can drive the terminal front end. joule refuses to start without a
# tty (src/terminal/terminal.ts), and node cannot open one, so anything that
# has to be asserted about the terminal path needs this in between.
#
# Usage: pty_bridge.py <cols> <rows> <command> [args...]
# stdin is forwarded to the pty, everything the pty prints goes to stdout.
import fcntl
import os
import pty
import select
import struct
import sys
import termios


def main():
    cols = int(sys.argv[1])
    rows = int(sys.argv[2])
    cmd = sys.argv[3:]
    if not cmd:
        print("pty_bridge: nothing to run", file=sys.stderr)
        return 2

    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.execvp(cmd[0], cmd)
        except OSError as e:
            sys.stderr.write("pty_bridge: cannot run %s: %s\n" % (cmd[0], e))
        os._exit(127)

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    stdin_fd = sys.stdin.fileno()
    out = sys.stdout.buffer
    watching = [fd, stdin_fd]
    alive = True

    while alive:
        try:
            readable, _, _ = select.select(watching, [], [], 0.2)
        except (OSError, ValueError):
            break
        if fd in readable:
            try:
                data = os.read(fd, 65536)
            except OSError:
                data = b""
            if not data:
                alive = False
            else:
                out.write(data)
                out.flush()
        if stdin_fd in readable:
            try:
                data = os.read(stdin_fd, 65536)
            except OSError:
                data = b""
            if not data:
                watching = [fd]
            else:
                os.write(fd, data)

    try:
        os.close(fd)
    except OSError:
        pass
    _, status = os.waitpid(pid, 0)
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    return 1


if __name__ == "__main__":
    sys.exit(main())
