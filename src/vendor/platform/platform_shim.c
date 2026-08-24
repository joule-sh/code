// The two calls Lumen's runtime cannot make on Windows, in portable C.
//
// `process.env` is the larger of the two. Lumen v0.7.2 reads the environment
// through Zig's `std.process.Environ.getPosix`, which walks a POSIX `environ`
// block; on a Windows target the block is a different type and the compile
// fails outright, so every one of this repo's env reads had to go somewhere.
// `getenv` is the answer that needs no platform split at all: it is C89, and
// the Microsoft CRT and glibc both have it.
//
// `fs.chmodSync` is the smaller one, and the honest answer is different on the
// two platforms rather than the same. POSIX has a mode word; Windows has ACLs
// and a read-only bit that is not the same idea, so this does not pretend to
// apply one. plat_chmod says which happened - 0 applied, 1 declined because
// the platform has no equivalent - and leaves the caller to decide whether
// that matters. It matters for the credentials file, and src/auth/credentials
// says so where it calls this.
//
// Build:
//   cc -c platform_shim.c -o platform_shim.o
//   zig cc -target x86_64-windows-gnu -c platform_shim.c -o platform_shim.o

#include <stdlib.h>

#ifndef _WIN32
#include <sys/stat.h>
#endif

// The value of `name`, or an empty string if it is unset. An unset variable
// and one set to "" are told apart by plat_env_present, not by this.
const char *plat_env(const char *name) {
    const char *value = getenv(name);
    return value ? value : "";
}

int plat_env_present(const char *name) {
    return getenv(name) != NULL ? 1 : 0;
}

// 0 if the mode was applied, 1 if the platform has no equivalent to apply,
// -1 if applying it failed.
int plat_chmod(const char *path, int mode) {
#ifdef _WIN32
    (void)path;
    (void)mode;
    return 1;
#else
    return chmod(path, (mode_t)mode) == 0 ? 0 : -1;
#endif
}
