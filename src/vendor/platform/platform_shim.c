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
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

// The value of `name`, or an empty string if it is unset. An unset variable
// and one set to "" are told apart by plat_env_present, not by this.
//
// The answer is a copy, deliberately. getenv hands back a pointer into the
// process environment block, and handing that across the FFI makes the
// caller's ownership of it a question - if the runtime frees what a string
// call returns, freeing that pointer corrupts the heap in a way that surfaces
// nowhere near here. A copy is correct whichever answer the runtime gives,
// and this is called a few dozen times in a process lifetime.
const char *plat_env(const char *name) {
    const char *value = getenv(name);
    if (value == NULL) {
        return "";
    }
    size_t len = strlen(value);
    char *copy = (char *)malloc(len + 1);
    if (copy == NULL) {
        return "";
    }
    memcpy(copy, value, len + 1);
    return copy;
}

int plat_env_present(const char *name) {
    return getenv(name) != NULL ? 1 : 0;
}

// Append `text` to `path`, creating it if absent. 0 on success, -1 on failure.
//
// This is here rather than spelled with fs calls because Lumen's openSync(p,
// "a") does not append: a handle opened that way writes from offset zero, so
// three reopened writes leave only the third. The mailboxes this repo streams
// model output through are append-only files with several writers, and doing
// it wrong does not lose a line - it overwrites earlier ones, and the reader
// then renders whatever fragments straddle the seam.
//
// O_APPEND and FILE_APPEND_DATA are the two platforms' names for the same
// guarantee: the offset is taken at write time, under the file lock, so two
// writers interleave whole records rather than landing on each other.
int plat_append(const char *path, const char *text) {
    size_t len = strlen(text);
#ifdef _WIN32
    HANDLE h = CreateFileA(path, FILE_APPEND_DATA,
                           FILE_SHARE_READ | FILE_SHARE_WRITE, NULL,
                           OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) {
        return -1;
    }
    DWORD written = 0;
    BOOL ok = len == 0 ? TRUE : WriteFile(h, text, (DWORD)len, &written, NULL);
    CloseHandle(h);
    return (ok && written == (DWORD)len) ? 0 : -1;
#else
    int fd = open(path, O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (fd < 0) {
        return -1;
    }
    ssize_t n = len == 0 ? 0 : write(fd, text, len);
    close(fd);
    return n == (ssize_t)len ? 0 : -1;
#endif
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
