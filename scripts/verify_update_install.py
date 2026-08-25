#!/usr/bin/env python3
import errno
import fcntl
import os
import shutil
import select
import signal
import struct
import stat
import sys
import termios
import time

REPO_ROOT = os.environ.get("JOULE_REPO_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOULE_BIN = os.path.join(REPO_ROOT, "bin", "joule")

failures = []


def ok(cond, label):
    if cond:
        print("ok: " + label)
    else:
        failures.append(label)
        print("FAIL: " + label, file=sys.stderr)


class PtySession:
    def __init__(self, cmd, env, cwd, rows=24, cols=80):
        self.rows = rows
        self.cols = cols
        master_fd, slave_fd = os.openpty()
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
        pid = os.fork()
        if pid == 0:
            self._child(cmd, env, cwd, master_fd, slave_fd)
        os.close(slave_fd)
        self.master_fd = master_fd
        self.pid = pid
        self.reaped = False
        self.raw = bytearray()
        flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    def _child(self, cmd, env, cwd, master_fd, slave_fd):
        try:
            os.close(master_fd)
            os.setsid()
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
            os.dup2(slave_fd, 0)
            os.dup2(slave_fd, 1)
            os.dup2(slave_fd, 2)
            if slave_fd > 2:
                os.close(slave_fd)
            os.chdir(cwd)
            os.execvpe(cmd[0], cmd, env)
        except Exception as e:
            try:
                os.write(2, ("verify_update_install: exec failed: " + str(e) + "\n").encode())
            except Exception:
                pass
            os._exit(127)

    def _pump(self, timeout):
        deadline = time.time() + timeout
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                return
            r, _, _ = select.select([self.master_fd], [], [], remaining)
            if self.master_fd not in r:
                return
            try:
                chunk = os.read(self.master_fd, 65536)
            except OSError as e:
                if e.errno in (errno.EIO, errno.EBADF):
                    return
                raise
            if not chunk:
                return
            self.raw.extend(chunk)

    def write(self, data):
        if isinstance(data, str):
            data = data.encode()
        os.write(self.master_fd, data)

    def wait_for(self, needle, timeout=10.0):
        deadline = time.time() + timeout
        needle_b = needle.encode() if isinstance(needle, str) else needle
        while time.time() < deadline:
            idx = self.raw.find(needle_b)
            if idx >= 0:
                return idx
            self._pump(0.05)
        return -1

    def settle(self, quiet=0.3, cap=4.0):
        start = time.time()
        last_len = len(self.raw)
        while time.time() - start < cap:
            self._pump(quiet)
            if len(self.raw) == last_len:
                return
            last_len = len(self.raw)

    def wait_exit(self, timeout=5.0):
        if self.reaped:
            return True
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                pid, status = os.waitpid(self.pid, os.WNOHANG)
            except ChildProcessError:
                self.reaped = True
                return True
            if pid != 0:
                self.reaped = True
                return True
            time.sleep(0.05)
        return False

    def kill_now(self, sig=signal.SIGKILL):
        try:
            os.kill(self.pid, sig)
        except ProcessLookupError:
            pass
        self.wait_exit(5.0)

    def close(self):
        if self.reaped:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            return
        try:
            os.kill(self.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        if not self.wait_exit(2.0):
            try:
                os.kill(self.pid, signal.SIGKILL)
                os.waitpid(self.pid, 0)
            except (ProcessLookupError, ChildProcessError):
                pass
        try:
            os.close(self.master_fd)
        except OSError:
            pass


def text(raw_bytes):
    return raw_bytes.decode("latin1")


def run(cmd, cwd=None, env=None, check=True):
    import subprocess
    r = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError("command failed: %r\nstdout=%s\nstderr=%s" % (cmd, r.stdout, r.stderr))
    return r


def make_workspace(name):
    d = "/tmp/update-install-verify-workspace-" + name
    if os.path.isdir(d):
        shutil.rmtree(d)
    os.makedirs(d)
    return d


def fresh_dir(path):
    if os.path.isdir(path):
        shutil.rmtree(path)
    os.makedirs(path)
    return path


def install_layout(name, joule_src, relay_src, version_dir_name):
    install_root = fresh_dir("/tmp/update-install-verify-root-" + name)
    bin_dir = fresh_dir("/tmp/update-install-verify-bin-" + name)
    version_dir = os.path.join(install_root, version_dir_name)
    os.makedirs(version_dir)
    joule_dst = os.path.join(version_dir, "joule")
    shutil.copy(joule_src, joule_dst)
    os.chmod(joule_dst, 0o755)
    if relay_src and os.path.exists(relay_src):
        relay_dst = os.path.join(version_dir, "relay")
        shutil.copy(relay_src, relay_dst)
        os.chmod(relay_dst, 0o755)
    os.symlink(joule_dst, os.path.join(bin_dir, "joule"))
    if relay_src and os.path.exists(relay_src):
        os.symlink(os.path.join(version_dir, "relay"), os.path.join(bin_dir, "relay"))
    return install_root, bin_dir, joule_dst


def base_env(scratch_home, install_root, bin_dir, extra_path=None):
    env = dict(os.environ)
    env["HOME"] = scratch_home
    env["CODE_INSTALL_ROOT"] = install_root
    env["CODE_BIN_DIR"] = bin_dir
    if extra_path:
        env["PATH"] = extra_path + ":" + env.get("PATH", "")
    return env


def list_tmp_dirs(install_root):
    if not os.path.isdir(install_root):
        return []
    return [n for n in os.listdir(install_root) if n.startswith(".update-tmp-")]


def real_version(exe):
    import subprocess
    r = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=10)
    return r.stdout.strip()


def accept_offer(sess, label, timeout=20.0):
    """Wait for the startup offer and take its default (accept) option.

    The offer is the only way to ask for an update now that the manual
    command is gone, so every install phase below comes through here.
    """
    found = sess.wait_for("1. Yes, update now", timeout=timeout)
    ok(found >= 0, "the automatic offer appeared before " + label)
    if found < 0:
        return False
    sess.write(b"\r")
    return True


def phase_offer_installs():
    print("=== phase 1: the automatic offer appears for real, and accepting it installs the latest release ===")
    install_root, bin_dir, old_joule = install_layout("offer", JOULE_BIN, os.path.join(REPO_ROOT, "bin", "relay"), "0.5.0")
    scratch_home = fresh_dir("/tmp/update-install-verify-home-offer")
    workspace = make_workspace("offer")

    old_version_before = real_version(old_joule)
    print("old binary reports: %r" % old_version_before)

    env = base_env(scratch_home, install_root, bin_dir)
    env["JOULE_CODE_API_KEY"] = "stub-key"
    env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:1"
    env["JOULE_CODE_MODEL"] = "stub-model"

    sess = PtySession([old_joule], env, workspace, rows=24, cols=80)
    idx = sess.wait_for("joule - type a request", timeout=8.0)
    ok(idx >= 0, "the banner appeared at startup")
    found_offer = sess.wait_for("a newer release is available", timeout=15.0)
    ok(found_offer >= 0, "the startup check found a newer release and printed the offer banner")
    found_options = sess.wait_for("1. Yes, update now", timeout=5.0)
    ok(found_options >= 0, "the offer renders the reused approval-style numbered option list")
    output_before_answer = text(bytes(sess.raw))
    ok("2. Yes, and don't ask again" in output_before_answer, "option 2 offers to stop checking as well as update")
    ok("3. Not now" in output_before_answer, "option 3 lets the user decline for now")

    sess.write(b"\r")
    found = sess.wait_for("updated from", timeout=90.0)
    output = text(bytes(sess.raw))
    ok(found >= 0, "accepting the offer reported an installed update within the timeout")
    if found < 0:
        print("output so far:\n" + output[-3000:])
    sess.settle(quiet=0.3, cap=1.0)
    sess.write(b"\x04")
    sess.wait_exit(5.0)
    sess.close()
    output = text(bytes(sess.raw))
    print("relevant tail:\n" + output[output.find("checking for updates"):][:600] if "checking for updates" in output else output[-600:])

    latest_dirs = [n for n in os.listdir(install_root) if n not in ("0.5.0",) and not n.startswith(".update-tmp-")]
    ok(len(latest_dirs) == 1, "exactly one new version directory was installed alongside the old one, got %r" % latest_dirs)
    ok(os.path.isdir(os.path.join(install_root, "0.5.0")), "the old version directory (0.5.0) is untouched and still present")

    new_link = os.path.join(bin_dir, "joule")
    ok(os.path.islink(new_link), "the bin_dir joule entry is still a symlink after the update")
    new_target = os.path.realpath(new_link)
    ok(latest_dirs and new_target == os.path.realpath(os.path.join(install_root, latest_dirs[0], "joule")), "the symlink was repointed at the newly installed version's joule binary")

    new_version = real_version(new_target) if latest_dirs else ""
    print("new binary reports: %r" % new_version)
    ok(new_version != "" and new_version != old_version_before, "the newly installed binary actually runs and reports a different (newer) version than before")

    ok(len(list_tmp_dirs(install_root)) == 0, "no .update-tmp-* scratch directories are left behind after a successful update")

    still_runs = real_version(old_joule)
    ok(still_runs == old_version_before, "the untouched old binary at its original path still runs and still reports its original version")


def phase_offer_decline_and_dont_ask_again():
    print("=== phase 1b: declining the offer changes nothing, and don't ask again turns checks off ===")
    install_root, bin_dir, old_joule = install_layout("offerdecline", JOULE_BIN, os.path.join(REPO_ROOT, "bin", "relay"), "0.5.0")
    scratch_home = fresh_dir("/tmp/update-install-verify-home-offerdecline")
    workspace = make_workspace("offerdecline")

    env = base_env(scratch_home, install_root, bin_dir)
    env["JOULE_CODE_API_KEY"] = "stub-key"
    env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:1"
    env["JOULE_CODE_MODEL"] = "stub-model"

    sess = PtySession([old_joule], env, workspace, rows=24, cols=80)
    sess.wait_for("joule - type a request", timeout=8.0)
    sess.wait_for("1. Yes, update now", timeout=15.0)
    sess.write(b"n")
    sess.settle(quiet=0.3, cap=2.0)
    sess.write(b"\x04")
    sess.wait_exit(5.0)
    sess.close()

    ok(len(os.listdir(install_root)) == 1, "declining with n leaves the install root with only the original version")
    config_path = os.path.join(scratch_home, ".config", "joule-code", "config.json")
    ok(not os.path.exists(config_path), "declining with n does not touch config.json")

    install_root2, bin_dir2, old_joule2 = install_layout("offerdontask", JOULE_BIN, os.path.join(REPO_ROOT, "bin", "relay"), "0.5.0")
    scratch_home2 = fresh_dir("/tmp/update-install-verify-home-offerdontask")
    workspace2 = make_workspace("offerdontask")
    env2 = base_env(scratch_home2, install_root2, bin_dir2)
    env2["JOULE_CODE_API_KEY"] = "stub-key"
    env2["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:1"
    env2["JOULE_CODE_MODEL"] = "stub-model"

    sess2 = PtySession([old_joule2], env2, workspace2, rows=24, cols=80)
    sess2.wait_for("joule - type a request", timeout=8.0)
    sess2.wait_for("1. Yes, update now", timeout=15.0)
    sess2.write(b"a")
    found_installed = sess2.wait_for("updated from", timeout=90.0)
    ok(found_installed >= 0, "choosing 'don't ask again' still runs the update")
    sess2.settle(quiet=0.3, cap=1.0)
    sess2.write(b"\x04")
    sess2.wait_exit(5.0)
    sess2.close()

    config_path2 = os.path.join(scratch_home2, ".config", "joule-code", "config.json")
    ok(os.path.exists(config_path2), "choosing 'don't ask again' wrote a config.json")
    if os.path.exists(config_path2):
        with open(config_path2) as f:
            body = f.read()
        print("config.json after 'don't ask again': %s" % body)
        ok('"updateCheck":"off"' in body, "the config file now disables future update checks")


def phase_interrupted_download():
    print("=== phase 2: killing joule mid-download leaves the existing binary intact and working ===")
    install_root, bin_dir, old_joule = install_layout("interrupt", JOULE_BIN, os.path.join(REPO_ROOT, "bin", "relay"), "0.5.0")
    scratch_home = fresh_dir("/tmp/update-install-verify-home-interrupt")
    workspace = make_workspace("interrupt")

    fake_bin = fresh_dir("/tmp/update-install-verify-fakebin-interrupt")
    fake_curl = os.path.join(fake_bin, "curl")
    with open(fake_curl, "w") as f:
        f.write("#!/bin/sh\nsleep 60\n")
    os.chmod(fake_curl, 0o755)

    old_version_before = real_version(old_joule)

    env = base_env(scratch_home, install_root, bin_dir, extra_path=fake_bin)
    env["JOULE_CODE_API_KEY"] = "stub-key"
    env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:1"
    env["JOULE_CODE_MODEL"] = "stub-model"

    sess = PtySession([old_joule], env, workspace, rows=24, cols=80)
    idx = sess.wait_for("joule - type a request", timeout=8.0)
    ok(idx >= 0, "the banner appeared before the offer was answered")
    accept_offer(sess, "the download could be interrupted")
    found_checking = sess.wait_for("checking for updates", timeout=15.0)
    ok(found_checking >= 0, "the update visibly started (checking for updates...) before being interrupted")
    time.sleep(1.5)
    sess.kill_now(signal.SIGKILL)
    sess.close()

    still_runs = real_version(old_joule)
    ok(still_runs == old_version_before, "after killing joule mid-download, the original binary still runs and reports its original version")
    ok(os.path.islink(os.path.join(bin_dir, "joule")), "the bin_dir symlink still points somewhere sane after the interruption")
    ok(os.path.realpath(os.path.join(bin_dir, "joule")) == os.path.realpath(old_joule), "the symlink was never repointed away from the old binary")


def phase_corrupt_archive():
    print("=== phase 3: a corrupt/truncated archive is refused and the old binary is left alone ===")
    install_root, bin_dir, old_joule = install_layout("corrupt", JOULE_BIN, os.path.join(REPO_ROOT, "bin", "relay"), "0.5.0")
    scratch_home = fresh_dir("/tmp/update-install-verify-home-corrupt")
    workspace = make_workspace("corrupt")

    fake_bin = fresh_dir("/tmp/update-install-verify-fakebin-corrupt")
    fake_curl = os.path.join(fake_bin, "curl")
    with open(fake_curl, "w") as f:
        f.write("#!/bin/sh\n"
                "for a in \"$@\"; do\n"
                "  if [ \"$prev\" = \"-o\" ]; then dest=\"$a\"; fi\n"
                "  prev=\"$a\"\n"
                "done\n"
                "echo 'this is not a gzip archive, just plain garbage bytes' > \"$dest\"\n"
                "exit 0\n")
    os.chmod(fake_curl, 0o755)

    old_version_before = real_version(old_joule)

    env = base_env(scratch_home, install_root, bin_dir, extra_path=fake_bin)
    env["JOULE_CODE_API_KEY"] = "stub-key"
    env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:1"
    env["JOULE_CODE_MODEL"] = "stub-model"

    sess = PtySession([old_joule], env, workspace, rows=24, cols=80)
    idx = sess.wait_for("joule - type a request", timeout=8.0)
    ok(idx >= 0, "the banner appeared before the offer was answered")
    accept_offer(sess, "the corrupt archive was fetched")
    found = sess.wait_for("update failed", timeout=30.0)
    output = text(bytes(sess.raw))
    ok(found >= 0, "the corrupt archive was refused with an update failed message")
    ok("corrupt or incomplete" in output, "the failure message names the archive as corrupt or incomplete")
    sess.settle(quiet=0.3, cap=1.0)
    sess.write(b"\x04")
    sess.wait_exit(5.0)
    sess.close()

    ok(len(list_tmp_dirs(install_root)) == 0, "no .update-tmp-* scratch directories are left behind after a refused corrupt archive")
    only_old = [n for n in os.listdir(install_root) if not n.startswith(".update-tmp-")]
    ok(only_old == ["0.5.0"], "no new version directory was created from the corrupt archive, got %r" % only_old)
    still_runs = real_version(old_joule)
    ok(still_runs == old_version_before, "the old binary still runs and reports its original version after the corrupt-archive refusal")


def phase_non_managed_install():
    print("=== phase 4: a binary neither installer owns is never offered an update, and nothing is written ===")
    workspace = make_workspace("nonmanaged")
    scratch_home = fresh_dir("/tmp/update-install-verify-home-nonmanaged")
    standalone_dir = fresh_dir("/tmp/update-install-verify-standalone")
    exe = os.path.join(standalone_dir, "joule")
    shutil.copy(JOULE_BIN, exe)
    os.chmod(exe, 0o755)

    install_root = fresh_dir("/tmp/update-install-verify-root-nonmanaged-unused")

    env = dict(os.environ)
    env["HOME"] = scratch_home
    env["CODE_INSTALL_ROOT"] = install_root
    env["JOULE_CODE_API_KEY"] = "stub-key"
    env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:1"
    env["JOULE_CODE_MODEL"] = "stub-model"

    sess = PtySession([exe], env, workspace, rows=24, cols=80)
    idx = sess.wait_for("joule - type a request", timeout=8.0)
    ok(idx >= 0, "the banner appeared for the non-managed binary")
    sess.wait_for("1. Yes, update now", timeout=8.0)
    sess.settle(quiet=0.3, cap=2.0)
    output = text(bytes(sess.raw))
    sess.write(b"\x04")
    sess.wait_exit(5.0)
    sess.close()

    ok("newer release is available" not in output, "a binary neither installer owns is never offered an update it could not carry out")
    ok("1. Yes, update now" not in output, "no offer option rows were drawn for the non-managed binary")
    ok(not os.path.isdir(install_root) or len(os.listdir(install_root)) == 0, "nothing was written under the install root for a non-managed binary")


def phase_source_build_declines(dev_exe):
    print("=== phase 5: a source (dev) build is never offered an update and leaves no scratch behind ===")
    workspace = make_workspace("devbuild")
    scratch_home = fresh_dir("/tmp/update-install-verify-home-devbuild")
    install_root, bin_dir, exe = install_layout("devbuild", dev_exe, None, "dev-test")

    env = base_env(scratch_home, install_root, bin_dir)
    env["JOULE_CODE_API_KEY"] = "stub-key"
    env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:1"
    env["JOULE_CODE_MODEL"] = "stub-model"

    sess = PtySession([exe], env, workspace, rows=24, cols=80)
    idx = sess.wait_for("joule - type a request", timeout=8.0)
    ok(idx >= 0, "the banner appeared for the dev-build run")
    sess.wait_for("1. Yes, update now", timeout=8.0)
    sess.settle(quiet=0.3, cap=2.0)
    output = text(bytes(sess.raw))
    sess.write(b"\x04")
    sess.wait_exit(5.0)
    sess.close()
    ok("newer release is available" not in output, "a dev/source build is never offered an update rather than attempting anything")
    ok(len(list_tmp_dirs(install_root)) == 0, "no scratch directories were created for a dev build")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    dev_exe = sys.argv[2] if len(sys.argv) > 2 else JOULE_BIN

    if which in ("all", "offer"):
        phase_offer_installs()
    if which in ("all", "offerdecline"):
        phase_offer_decline_and_dont_ask_again()
    if which in ("all", "interrupt"):
        phase_interrupted_download()
    if which in ("all", "corrupt"):
        phase_corrupt_archive()
    if which in ("all", "nonmanaged"):
        phase_non_managed_install()
    if which in ("all", "devbuild"):
        phase_source_build_declines(dev_exe)

    print()
    if failures:
        print("FAILURES:")
        for f in failures:
            print(" - " + f)
        sys.exit(1)
    print("all requested update-install verification phases passed")
