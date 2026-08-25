import os
import shutil
import tempfile
import time

STALE_SECONDS = 4 * 60 * 60


def scratch_base():
    named = (os.environ.get("JOULE_SCRATCH_DIR") or os.environ.get("RUNNER_TEMP") or "").strip()
    if named == "":
        return tempfile.gettempdir()
    os.makedirs(named, exist_ok=True)
    return named


def sweep_stale(prefix, base=None):
    directory = base or scratch_base()
    cutoff = time.time() - STALE_SECONDS
    try:
        names = os.listdir(directory)
    except OSError:
        return
    for name in names:
        if not name.startswith(prefix):
            continue
        full = os.path.join(directory, name)
        try:
            if os.lstat(full).st_mtime > cutoff:
                continue
        except OSError:
            continue
        shutil.rmtree(full, ignore_errors=True)


def scratch_dir(prefix):
    base = scratch_base()
    sweep_stale(prefix, base)
    return tempfile.mkdtemp(prefix=prefix, dir=base)
