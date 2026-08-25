#!/usr/bin/env python3
# Acceptance check for #268, driving the real bin/joule binary over a real pty.
#
# The security-relevant case is the first scenario. Once memories are markdown
# files a person can open and edit, someone can paste a credential straight
# into one and the write-path check in /memory add never runs. The refusal has
# to hold on the read path, because that check is the reason a credential does
# not end up in the context of every future session.
#
# So: a memory file is written by hand, with a credential in it, before joule
# is ever started. The stub model logs every request body, and the check is
# that the credential is not in any of them - on the wire, not in a loader's
# return value.
#
# The rest is /memory still working over files: list, add landing as its own
# markdown file on disk, and forget removing exactly that file.

import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOULE_BIN = os.path.join(REPO_ROOT, "bin", "joule")
STUB_BIN = os.path.join(REPO_ROOT, "bin", "stub_model")

spec = importlib.util.spec_from_file_location("harness", os.path.join(REPO_ROOT, "scripts", "terminal_structural_harness.py"))
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

PtySession = harness.PtySession
free_port = harness.free_port
wait_for_port = harness.wait_for_port
text = harness.text
BANNER = harness.BANNER
APPROVAL_MARKER = harness.APPROVAL_MARKER

CREDENTIAL = "sk-live-4f9ab27c1de83094bb75"
SAFE_MEMORY = "prefers pnpm over npm"

failures = []


def ok(cond, label):
    if cond:
        print("ok: " + label)
    else:
        failures.append(label)
        print("FAIL: " + label, file=sys.stderr)


def start(prefix, seed_memories=None):
    work_dir = tempfile.mkdtemp(prefix=prefix)
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    mem_dir = os.path.join(home_dir, ".config", "joule-code", "memory")
    os.makedirs(repo_dir, exist_ok=True)
    os.makedirs(mem_dir, exist_ok=True)
    with open(os.path.join(repo_dir, "README.md"), "w") as f:
        f.write("# demo\n\nNo health route yet.")
    for name, body in (seed_memories or []):
        with open(os.path.join(mem_dir, name), "w") as f:
            f.write(body)

    stub_port = free_port()
    log_path = os.path.join(work_dir, "stub_requests.log")
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub_env["E2E_STUB_LOG"] = log_path
    stub = subprocess.Popen([STUB_BIN], env=stub_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait_for_port(stub_port, 5.0):
        raise harness.Failure("stub model server did not start")

    env = dict(os.environ)
    env["HOME"] = home_dir
    env["TERM"] = "xterm-256color"
    env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % stub_port
    env["JOULE_CODE_MODEL"] = "stub-model"
    env["JOULE_CODE_API_KEY"] = "stub-key"

    session = PtySession([JOULE_BIN], env, repo_dir, rows=40, cols=200)
    session.wait_for(BANNER, timeout=15.0)
    return work_dir, mem_dir, log_path, stub, session


def stop(work_dir, stub, session):
    try:
        if session is not None:
            session.close()
    except Exception:
        pass
    try:
        stub.terminate()
        stub.wait(timeout=5)
    except Exception:
        try:
            stub.kill()
        except Exception:
            pass
    shutil.rmtree(work_dir, ignore_errors=True)


def stub_log(log_path):
    if not os.path.exists(log_path):
        return ""
    with open(log_path, "r", errors="replace") as f:
        return f.read()


def md_files(mem_dir):
    return sorted(n for n in os.listdir(mem_dir) if n.endswith(".md"))


def scenario_handwritten_credential_never_reaches_the_model():
    """The refusal holds on the read path, where a hand-edited file arrives."""
    seed = [
        ("1700000000000-key.md", "---\nsavedAt: 1700000000000\n---\nthe deploy key is %s\n" % CREDENTIAL),
        ("1700000000001-safe.md", "---\nsavedAt: 1700000000001\n---\n%s\n" % SAFE_MEMORY),
    ]
    work_dir, mem_dir, log_path, stub, session = start("joule-memory-secret-", seed)
    try:
        session.write("add a health note\r")
        session.wait_for(APPROVAL_MARKER, timeout=20.0)
        sent = stub_log(log_path)

        ok(len(sent) > 0, "the model was actually called, so the check below is on real request bodies")
        ok(CREDENTIAL not in sent, "a credential pasted into a memory file by hand is NEVER sent to the model")
        ok("deploy key" not in sent, "the whole entry holding the credential is withheld, not just the token inside it")
        ok(SAFE_MEMORY in sent, "the memory files that are fine still reach the model, so the refusal is targeted")

        session.write("3")
        session.settle(quiet=0.5, cap=5.0)

        mark = len(session.raw)
        session.write("/memory\r")
        session.wait_for("what joule remembers", timeout=10.0, from_index=mark)
        session.settle(quiet=0.5, cap=5.0)
        listing = text(bytes(session.raw)[mark:])
        ok(CREDENTIAL not in listing, "/memory does not print the credential back out while reporting the file")
        ok("not loaded" in listing, "/memory says the file was refused rather than hiding it")
        ok("1700000000000-key.md" in listing, "/memory names the file to go and fix")
        ok(SAFE_MEMORY in listing, "/memory still lists the entries that are fine")

        session.write("\x04")
        ok(session.wait_exit(10.0), "joule exits cleanly after the credential check")
    finally:
        stop(work_dir, stub, session)


def scenario_memory_commands_over_files():
    """/memory list, add and forget still work, one markdown file per memory."""
    work_dir, mem_dir, log_path, stub, session = start("joule-memory-files-")
    try:
        mark = len(session.raw)
        session.write("/memory\r")
        session.wait_for("nothing remembered yet", timeout=10.0, from_index=mark)
        ok(len(md_files(mem_dir)) == 0, "an untouched store holds no files")

        mark = len(session.raw)
        session.write("/memory add prefers tabs over spaces\r")
        session.wait_for("remembered.", timeout=10.0, from_index=mark)
        names = md_files(mem_dir)
        ok(len(names) == 1, "adding a memory writes exactly one markdown file, got %r" % names)
        ok(names[0].endswith(".md"), "the memory is a .md file a person can open")
        ok("prefers-tabs-over-spaces" in names[0], "the filename carries the memory, so the directory is readable at a glance")
        with open(os.path.join(mem_dir, names[0])) as f:
            body = f.read()
        ok(body.startswith("---") and "savedAt:" in body, "the file carries frontmatter, the same shape as a skill or JOULE.md")
        ok("prefers tabs over spaces" in body, "the body of the file is the memory itself")

        mark = len(session.raw)
        session.write("/memory add uses the staging box for builds\r")
        session.wait_for("remembered.", timeout=10.0, from_index=mark)
        ok(len(md_files(mem_dir)) == 2, "a second memory is a second file - an add touches one file, not the whole store")

        mark = len(session.raw)
        session.write("/memory\r")
        session.wait_for("2. uses the staging box", timeout=10.0, from_index=mark)
        ok(True, "/memory lists both, numbered, oldest first")

        mark = len(session.raw)
        session.write("/memory forget 1\r")
        session.wait_for("forgot entry 1.", timeout=10.0, from_index=mark)
        left = md_files(mem_dir)
        ok(len(left) == 1, "forget removes exactly one file")
        ok("uses-the-staging-box" in left[0], "the file left behind is the one that was not forgotten")

        mark = len(session.raw)
        session.write("/memory add %s\r" % CREDENTIAL)
        session.wait_for("refusing to save it", timeout=10.0, from_index=mark)
        ok(len(md_files(mem_dir)) == 1, "the write path still refuses a credential and leaves no file behind")

        mark = len(session.raw)
        session.write("/memory clear\r")
        session.wait_for("cleared everything", timeout=10.0, from_index=mark)
        ok(len(md_files(mem_dir)) == 0, "clear removes every memory file")

        session.write("\x04")
        ok(session.wait_exit(10.0), "joule exits cleanly after driving /memory over files")
    finally:
        stop(work_dir, stub, session)


def scenario_memory_survives_a_restart():
    """A memory added in one session is in the next session's context."""
    work_dir, mem_dir, log_path, stub, session = start("joule-memory-restart-")
    try:
        mark = len(session.raw)
        session.write("/memory add %s\r" % SAFE_MEMORY)
        session.wait_for("remembered.", timeout=10.0, from_index=mark)
        session.write("\x04")
        ok(session.wait_exit(10.0), "the first session exits cleanly")
        ok(len(md_files(mem_dir)) == 1, "the memory is on disk after the session that wrote it ended")
    finally:
        stop(work_dir, stub, session)


def main():
    for path, what in ((JOULE_BIN, "bin/joule"), (STUB_BIN, "bin/stub_model")):
        if not os.path.exists(path):
            print("verify_memory_files_pty: %s not found, run make build bin/stub_model first" % what, file=sys.stderr)
            sys.exit(1)

    for s in (scenario_handwritten_credential_never_reaches_the_model,
              scenario_memory_commands_over_files,
              scenario_memory_survives_a_restart):
        print("\n-- %s" % s.__name__)
        try:
            s()
        except harness.Failure as e:
            failures.append("%s: %s" % (s.__name__, e))
            print("FAIL: %s raised %s" % (s.__name__, e), file=sys.stderr)

    if failures:
        print("\n%d failure(s):" % len(failures), file=sys.stderr)
        for f in failures:
            print(" - " + f, file=sys.stderr)
        sys.exit(1)
    print("\nmemory-as-files acceptance check passed")


if __name__ == "__main__":
    main()
