#!/usr/bin/env python3
# A real client of one build meeting a real daemon of another, under a pty.
#
# The build-mismatch refusal (#276) had unit coverage for its wording and
# nothing that ran it: no harness put a client in front of a daemon that
# reported a different build and then watched what the process did next. So
# the refusal printed perfectly and the process aborted a moment later (#291),
# in the receive thread DaemonClient.connect had spawned and that disconnect()
# then closed the socket under.
#
# That is why every assertion here is paired with one about the process still
# being there. An output-only check passes against a build that prints all
# four lines and dies; the exit status is the part that tells them apart.
#
# The stale daemon is a real binary, not a script pretending to be one: this
# compiles src/daemon/daemon_main.ts a second time from a copy of the tree
# whose version.ts says something else, which is what a client meets when an
# install is half-updated.

import importlib.util
import os
import shutil
import signal
import socket
import subprocess
import sys
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts"))
import scratch

spec = importlib.util.spec_from_file_location("harness", os.path.join(REPO_ROOT, "scripts", "terminal_structural_harness.py"))
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

PtySession = harness.PtySession
Failure = harness.Failure
wait_for_port = harness.wait_for_port

JOULE_BIN = os.path.join(REPO_ROOT, "bin", "joule")
STUB_BIN = os.path.join(REPO_ROOT, "bin", "stub_model")
STALE_BUILD = "0.0.0-stale"
STALE_SRC = os.path.join(REPO_ROOT, "bin", "stale-src")
STALE_DAEMON = os.path.join(REPO_ROOT, "bin", "joule-daemon-stale")

BANNER = "type a request, /help for commands"
SURVIVAL_WATCH_S = 5.0
WHOLE_RUN_BUDGET_S = 420

failures = []
stage = "starting"


def say(line):
    print(line, flush=True)


def mark(name):
    global stage
    stage = name
    print("-- " + name, flush=True)


def give_up(signum, frame):
    print("FAIL: the harness itself hung at stage %r" % stage, file=sys.stderr, flush=True)
    os._exit(1)


def ok(cond, label):
    if cond:
        say("ok: " + label)
    else:
        failures.append(label)
        print("FAIL: " + label, file=sys.stderr, flush=True)


def free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def build_stale_daemon():
    # A copy of src with one line changed, compiled in the repo root so the
    # package cache and the shim objects the sources @link are the ones the
    # normal build already produced. Nothing is fetched, and nothing in the
    # working tree is touched.
    shutil.rmtree(STALE_SRC, ignore_errors=True)
    shutil.copytree(os.path.join(REPO_ROOT, "src"), STALE_SRC)
    with open(os.path.join(STALE_SRC, "version.ts"), "w") as f:
        f.write('export const VERSION: string = "' + STALE_BUILD + '";\n')
    entry = os.path.relpath(os.path.join(STALE_SRC, "daemon", "daemon_main.ts"), REPO_ROOT)
    built = subprocess.run(["lumen", "compile", entry], cwd=REPO_ROOT, capture_output=True, text=True)
    produced = os.path.join(REPO_ROOT, "daemon_main")
    if built.returncode != 0 or not os.path.exists(produced):
        print(built.stdout, file=sys.stderr)
        print(built.stderr, file=sys.stderr)
        raise SystemExit("could not compile a daemon of another build")
    if os.path.exists(STALE_DAEMON):
        os.unlink(STALE_DAEMON)
    os.rename(produced, STALE_DAEMON)
    shutil.rmtree(STALE_SRC, ignore_errors=True)


def version_of(binary):
    # "joule dev" / "joule-daemon 0.0.0-stale" - the build is the last word,
    # and it is the build the refusal names.
    out = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=60)
    return out.stdout.strip().split()[-1]


def kill_quietly(proc):
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()
        try:
            proc.wait(timeout=5)
        except Exception:
            pass


def still_running(session):
    # waitpid rather than kill(0): a client that aborted is a zombie until it
    # is reaped, and signalling a zombie succeeds, so kill(0) would report a
    # crashed process as alive.
    if session.reaped:
        return False
    pid, status = os.waitpid(session.pid, os.WNOHANG)
    if pid == 0:
        return True
    session.reaped = True
    session.status = status
    return False


def describe_status(status):
    if status is None:
        return "did not exit"
    if os.WIFSIGNALED(status):
        return "killed by signal %d (%s)" % (os.WTERMSIG(status), signal.Signals(os.WTERMSIG(status)).name)
    if os.WIFEXITED(status):
        return "exited %d" % os.WEXITSTATUS(status)
    return "wait status %d" % status


def reap(session, timeout):
    if session.reaped:
        return getattr(session, "status", None)
    deadline = time.time() + timeout
    while time.time() < deadline:
        pid, status = os.waitpid(session.pid, os.WNOHANG)
        if pid != 0:
            session.reaped = True
            session.status = status
            return status
        session._pump(0.05)
    return None


def dump(session, why):
    print("--- %s; %d bytes captured from the pty:" % (why, len(session.raw)), file=sys.stderr, flush=True)
    print(bytes(session.raw).decode("utf-8", "replace"), file=sys.stderr, flush=True)


def main():
    signal.signal(signal.SIGALRM, give_up)
    signal.alarm(WHOLE_RUN_BUDGET_S)

    mark("building a daemon of another build")
    build_stale_daemon()
    client_build = version_of(JOULE_BIN)
    daemon_build = version_of(STALE_DAEMON)
    say("   client: " + client_build)
    say("   daemon: " + daemon_build)
    ok(client_build != daemon_build, "the client and the daemon really are different builds")

    mark("setting up")
    home = scratch.scratch_dir("joule-mismatch-home-")
    workspace = scratch.scratch_dir("joule-mismatch-ws-")
    os.makedirs(os.path.join(home, ".config", "joule-code"), exist_ok=True)
    with open(os.path.join(workspace, "README.md"), "w") as f:
        f.write("# demo\n")

    stub_port = free_port()
    daemon_port = free_port()

    common = dict(os.environ)
    common["HOME"] = home
    common["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % stub_port
    common["JOULE_CODE_MODEL"] = "stub-model"
    common["JOULE_CODE_API_KEY"] = "test-key"
    common["JOULE_UPDATE_CHECK"] = "off"
    common.pop("JOULE_DAEMON_PORT", None)

    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub = subprocess.Popen([STUB_BIN], cwd=workspace, env=stub_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    daemon_env = dict(common)
    daemon_env["JOULE_DAEMON_PORT"] = str(daemon_port)
    daemon_log_path = os.path.join(workspace, "stale-daemon.log")
    daemon_log = open(daemon_log_path, "w")
    daemon = subprocess.Popen([STALE_DAEMON], cwd=workspace, env=daemon_env, stdout=daemon_log, stderr=daemon_log)

    session = None
    try:
        ok(wait_for_port(stub_port, 10.0), "stub model came up")
        ok(wait_for_port(daemon_port, 20.0), "the stale daemon came up")

        client_env = dict(common)
        client_env["TERM"] = "xterm-256color"

        mark("starting a client of the current build against it")
        session = PtySession([JOULE_BIN], client_env, workspace, rows=24, cols=100)
        session.status = None

        refused = True
        for needle in ("this client is joule " + client_build,
                       "is joule " + daemon_build,
                       "will not attach to a daemon of another build",
                       "stop that daemon with joule --stop"):
            try:
                session.wait_for(needle, timeout=45.0)
                say("ok: the refusal says " + repr(needle))
            except Failure:
                refused = False
                ok(False, "the refusal says " + repr(needle))
        if not refused:
            dump(session, "the refusal did not read as expected")
        try:
            session.wait_for("running in-process", timeout=20.0)
            ok(True, "the client says it is carrying on in-process")
        except Failure:
            ok(False, "the client says it is carrying on in-process")
            dump(session, "no in-process note")

        # The whole point. Everything above passed against the build that
        # aborted; what the process did next is the part that was broken.
        mark("watching whether it survives having said all that")
        alive = True
        deadline = time.time() + SURVIVAL_WATCH_S
        while time.time() < deadline:
            if not still_running(session):
                alive = False
                break
            session._pump(0.1)
        ok(alive, "the client is still running %.0fs after printing the refusal" % SURVIVAL_WATCH_S)
        if not alive:
            print("FAIL: the client " + describe_status(session.status) + " after refusing the daemon", file=sys.stderr, flush=True)
            dump(session, "the client died on its way out of the refusal")

        if alive:
            mark("using the in-process session it fell back to")
            painted = True
            try:
                session.wait_for(BANNER, timeout=45.0)
            except Failure:
                painted = False
                dump(session, "the in-process session never painted")
            ok(painted, "the in-process session it fell back to paints a prompt")
            if painted:
                session.write("fix the health route\r")
                answered = True
                try:
                    session.wait_for("Let me check the README", timeout=45.0)
                    session.wait_for("run", timeout=45.0)
                    session.write("y")
                    session.wait_for("Done.", timeout=45.0)
                except Failure:
                    answered = False
                    dump(session, "the in-process session did not finish a turn")
                ok(answered, "the session the user was left with can still run a turn end to end")

            mark("sending ctrl-d")
            session.write("\x04")
            status = reap(session, 30.0)
            ok(status is not None, "the client exits on ctrl-d")
            if status is not None:
                say("   " + describe_status(status))
                ok(not os.WIFSIGNALED(status), "the client exits rather than being killed by a signal")
                ok(os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0, "the client exits 0")

        ok(daemon.poll() is None, "the stale daemon is still up - the client refused it, it did not stop it")
    finally:
        mark("cleaning up")
        if session is not None:
            session.close()
        kill_quietly(daemon)
        kill_quietly(stub)
        daemon_log.close()
        if failures:
            try:
                with open(daemon_log_path, errors="replace") as f:
                    body = f.read().strip()
                if body:
                    print("--- stale daemon log", file=sys.stderr, flush=True)
                    print(body, file=sys.stderr, flush=True)
            except OSError:
                pass
        shutil.rmtree(home, ignore_errors=True)
        shutil.rmtree(workspace, ignore_errors=True)
        shutil.rmtree(STALE_SRC, ignore_errors=True)
        if os.path.exists(STALE_DAEMON):
            os.unlink(STALE_DAEMON)
        signal.alarm(0)

    if failures:
        print("\n%d check(s) failed" % len(failures), file=sys.stderr, flush=True)
        sys.exit(1)
    say("\nbuild-mismatch verification passed")


if __name__ == "__main__":
    main()
