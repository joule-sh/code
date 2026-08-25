#!/usr/bin/env python3
# Acceptance check for #266, driving the real bin/joule binary over a real pty.
#
# Four things this proves that a unit test cannot:
#
#   1. A skill written into .claude/skills - a directory someone wrote for
#      another tool - is found, listed with the file it came from, and the
#      startup block says the directory is being read rather than reading it
#      in silence.
#   2. A skill's description reaches the model every session, and its body
#      does not. The stub model logs every request body, so the check is on
#      what actually went over the wire, not on what the loader returned.
#   3. Invoking a skill by name puts its body in front of the model, and a
#      script the skill carries reaches the approval gate like any other
#      command, with the skill's own directory visible in what is being
#      approved.
#   4. full-auto governs a skill's script with no exception: the same skill in
#      that mode runs its script unprompted. That is the settled decision in
#      #266, so it is checked rather than assumed.
#
# Reuses PtySession and friends from terminal_structural_harness.py.

import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import time

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

BODY_MARKER = "SKILL_BODY_MARKER_ZQX"
DESCRIPTION = "use when shipping a release to production"
SCRIPT_OUTPUT = "DEPLOY_SCRIPT_RAN_ZQX"

failures = []


def ok(cond, label):
    if cond:
        print("ok: " + label)
    else:
        failures.append(label)
        print("FAIL: " + label, file=sys.stderr)


def write(path, body):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(body)


def seed(repo_dir):
    """A project carrying one skill in .claude/ and one in .joule/."""
    write(os.path.join(repo_dir, "README.md"), "# demo\n\nNo health route yet.")
    write(os.path.join(repo_dir, ".claude", "skills", "deploy", "SKILL.md"),
          "---\nname: deploy\ndescription: %s\nmode: full-auto\n---\n%s\nRun `sh .claude/skills/deploy/deploy.sh` to ship.\n" % (DESCRIPTION, BODY_MARKER))
    write(os.path.join(repo_dir, ".claude", "skills", "deploy", "deploy.sh"),
          "#!/bin/sh\necho %s > deployed.txt\n" % SCRIPT_OUTPUT)
    write(os.path.join(repo_dir, ".joule", "skills", "review.md"),
          "---\nname: review\ndescription: use when reviewing a diff before merging\n---\nCheck the tests changed.\n")


def start(prefix, script=""):
    work_dir = tempfile.mkdtemp(prefix=prefix)
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(home_dir, exist_ok=True)
    seed(repo_dir)

    stub_port = free_port()
    log_path = os.path.join(work_dir, "stub_requests.log")
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub_env["E2E_STUB_LOG"] = log_path
    stub_env["E2E_STUB_SCRIPT"] = script
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
    return work_dir, repo_dir, log_path, stub, session


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


def wait_for_file(session, path, timeout_s):
    """Wait for a file, draining the pty meanwhile.

    Nothing else reads the pty, so a wait that only sleeps lets the child
    block writing its next redraw and the turn never finishes.
    """
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if os.path.exists(path):
            return True
        session._pump(0.2)
    return os.path.exists(path)


def scenario_listing_and_provenance():
    """A skill is listed, and where it came from is on screen."""
    work_dir, repo_dir, log_path, stub, session = start("joule-skills-listing-")
    try:
        banner_text = text(bytes(session.raw))
        ok("skills loaded" in banner_text, "the startup block says skills were loaded rather than loading them in silence")
        ok("also reading" in banner_text and ".claude" in banner_text, "the startup block says a directory written for another tool is being read")

        session.write("/skills\r")
        session.wait_for("searched, in this order", timeout=10.0)
        session.settle(quiet=0.5, cap=5.0)
        listing = text(bytes(session.raw))

        ok("deploy" in listing, "/skills lists the skill found in .claude/skills")
        ok(DESCRIPTION in listing, "/skills shows the description, which is what the model matches on")
        ok("review" in listing, "/skills lists the skill found in .joule/skills")
        ok(".claude/skills/deploy/SKILL.md" in listing, "/skills names the file each skill came from, so provenance is visible without reading source")
        ok("project .claude" in listing, "/skills labels the origin of a skill that came from the repository")
        ok("user" in listing, "/skills names every directory searched, including the ones with nothing in them")
        ok("cannot replace a skill you wrote" in listing, "/skills states the precedence rule rather than leaving it to the source")
        ok(BODY_MARKER not in listing, "/skills lists descriptions only - a skill's body is not printed just to list it")

        mark = len(session.raw)
        session.write("/help\r")
        session.wait_for("list skills and where each came from", timeout=10.0, from_index=mark)
        ok(True, "/help lists /skills, so the feature can be found without reading source")

        session.write("\x04")
        ok(session.wait_exit(10.0), "joule exits cleanly after listing skills")
    finally:
        stop(work_dir, stub, session)


def scenario_body_is_not_loaded_until_used():
    """The description is in every session; the body costs nothing until used."""
    work_dir, repo_dir, log_path, stub, session = start("joule-skills-lazy-")
    try:
        session.write("add a health note\r")
        session.wait_for(APPROVAL_MARKER, timeout=20.0)
        sent = stub_log(log_path)

        ok(DESCRIPTION in sent, "the skill's description is sent to the model without the skill being used")
        ok(BODY_MARKER not in sent, "the skill's body is NOT sent to the model until the skill is used")
        ok("deploy" in sent, "the skill is named to the model, so it can choose one by description")

        session.write("3")
        session.settle(quiet=0.5, cap=5.0)
        session.write("\x04")
        ok(session.wait_exit(10.0), "joule exits cleanly after declining the command")
    finally:
        stop(work_dir, stub, session)


def scenario_invoke_and_approve_script():
    """Typing a skill by name loads its body, and its script hits the gate."""
    work_dir, repo_dir, log_path, stub, session = start("joule-skills-invoke-", script="skills")
    try:
        session.write("/skills deploy\r")
        session.wait_for("using skill", timeout=10.0)
        session.settle(quiet=0.5, cap=5.0)
        shown = text(bytes(session.raw))
        ok("using skill" in shown and "deploy" in shown, "invoking a skill by name says which skill is being used")
        ok(".claude/skills/deploy/SKILL.md" in shown, "the line naming the skill in use carries the file it came from")

        session.wait_for(APPROVAL_MARKER, timeout=20.0)
        session.settle(quiet=0.5, cap=5.0)
        card = text(bytes(session.raw))
        ok("deploy.sh" in card, "a script carried by a skill reaches the approval gate like any other command")
        ok(".claude/skills/deploy" in card, "what is being approved names the skill directory the script came from")

        sent = stub_log(log_path)
        ok(BODY_MARKER in sent, "the skill's body reaches the model once the skill is used, and only then")
        ok("approval gate" in sent and "must be refused" in sent, "the body arrives with the statement that a skill cannot widen its own permissions")

        deployed = os.path.join(repo_dir, "deployed.txt")
        ok(not os.path.exists(deployed), "the skill's script has not run while the approval is still pending")

        session.write("1")
        ok(wait_for_file(session, deployed, 20.0), "answering yes runs the skill's script")
        session.settle(quiet=0.5, cap=5.0)
        with open(deployed) as f:
            ok(SCRIPT_OUTPUT in f.read(), "the script that ran is the one the skill carried")

        session.write("\x04")
        ok(session.wait_exit(10.0), "joule exits cleanly after running a skill's script")
    finally:
        stop(work_dir, stub, session)


def scenario_full_auto_governs_skill_scripts():
    """The settled decision in #266: full-auto governs skill scripts too."""
    work_dir, repo_dir, log_path, stub, session = start("joule-skills-fullauto-", script="skills")
    try:
        session.write("/mode full-auto\r")
        session.settle(quiet=0.5, cap=5.0)

        before = len(session.raw)
        session.write("/skills deploy\r")
        deployed = os.path.join(repo_dir, "deployed.txt")
        ok(wait_for_file(session, deployed, 30.0), "in full-auto a skill's script runs without asking - the mode governs it with no exception")
        session.settle(quiet=0.5, cap=5.0)
        after = text(bytes(session.raw)[before:])
        ok(APPROVAL_MARKER not in after, "no approval was raised for the skill's script in full-auto")

        session.write("\x04")
        ok(session.wait_exit(10.0), "joule exits cleanly after a full-auto skill run")
    finally:
        stop(work_dir, stub, session)


def scenario_skill_cannot_widen_its_own_permissions():
    """A skill's frontmatter asking for full-auto is ignored and says so."""
    work_dir, repo_dir, log_path, stub, session = start("joule-skills-widening-")
    try:
        session.write("/skills\r")
        session.wait_for("searched, in this order", timeout=10.0)
        session.settle(quiet=0.5, cap=5.0)
        listing = text(bytes(session.raw))
        ok("cannot set the approval mode" in listing, "a skill asking for an approval mode in its frontmatter is refused, and the listing says so")

        mark = len(session.raw)
        session.write("/mode\r")
        session.wait_for("mode: auto-edit", timeout=10.0, from_index=mark)
        ok(True, "the approval mode is still the default - the skill's frontmatter did not change it")

        session.write("\x04")
        ok(session.wait_exit(10.0), "joule exits cleanly after the permission-widening check")
    finally:
        stop(work_dir, stub, session)


def main():
    for path, what in ((JOULE_BIN, "bin/joule"), (STUB_BIN, "bin/stub_model")):
        if not os.path.exists(path):
            print("verify_skills_pty: %s not found, run make build bin/stub_model first" % what, file=sys.stderr)
            sys.exit(1)

    scenarios = [
        scenario_listing_and_provenance,
        scenario_body_is_not_loaded_until_used,
        scenario_invoke_and_approve_script,
        scenario_full_auto_governs_skill_scripts,
        scenario_skill_cannot_widen_its_own_permissions,
    ]
    for s in scenarios:
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
    print("\nskills acceptance check passed")


if __name__ == "__main__":
    main()
