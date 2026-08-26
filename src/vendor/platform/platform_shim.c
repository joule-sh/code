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
#include <winsock2.h>
#include <ws2tcpip.h>
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

// The third platform-specific runtime fault this repo has had to carry, after
// the append mode of lumen#40 and the `process.env` of lumen#41, and the one
// that made the Windows build unusable rather than merely awkward (#248) and
// then made a live shared session invisible to the account that owned it
// (#292).
//
// A Lumen string is a pointer and a length. `split` and `slice` hand back a
// window into the string they were given rather than a copy, so anything that
// keeps a parsed field keeps a pointer into the middle of the buffer that
// field was parsed out of, and nothing points at that buffer's first byte.
// Boehm keeps such an object alive only when GC_all_interior_pointers is on.
//
// It is on in the collector a plain `cc` build links, which is the collector
// every test and harness in this repo runs against. It is off in the copy
// Lumen links in when the build names a target: x86_64-windows-gnu, and also
// x86_64-linux-musl, which is what a Linux release is built as. So a released
// relay collected the buffer a create command was parsed out of while the
// session record still held windows into it, and the accountId that record is
// found by became whatever allocated there next. The session stayed pairable
// by its code - generated locally, a whole object, never a window - and went
// unlistable for its own account seconds after it was made.
//
// This turns it back on for every target rather than for one, because the flag
// is not a Windows question: it is a question about which collector got
// linked, the answer differs per target, and nothing in the source says which.
// It has to happen before the collector's first allocation, because the flag
// decides how the heap is laid out; a constructor runs before main and
// therefore before Lumen's runtime has allocated anything. Reading it back is
// what makes a build that did not take the flag die at startup instead of
// reading other people's memory quietly, and plat_gc_interior_pointers reports
// it so a test can say so rather than trusting link order nobody checks.
//
// The fix belongs upstream, which is lumen-lang-org/lumen#42, and this comes
// out when a Lumen release carries it.
extern void GC_set_all_interior_pointers(int);
extern int GC_get_all_interior_pointers(void);

static const char plat_gc_refusal[] =
    "joule: the collector kept interior pointers off; this build would\n"
    "read memory that has been handed to something else (#248, #292)\n";

__attribute__((constructor)) static void plat_gc_enable_interior_pointers(void) {
    GC_set_all_interior_pointers(1);
    if (GC_get_all_interior_pointers() == 1) {
        return;
    }
#ifdef _WIN32
    DWORD written = 0;
    WriteFile(GetStdHandle(STD_ERROR_HANDLE), plat_gc_refusal,
              (DWORD)strlen(plat_gc_refusal), &written, NULL);
    ExitProcess(70);
#else
    if (write(2, plat_gc_refusal, strlen(plat_gc_refusal)) < 0) {
        _exit(70);
    }
    _exit(70);
#endif
}

int plat_gc_interior_pointers(void) {
    return GC_get_all_interior_pointers();
}

// Whether anything is accepting on host:port, answered without going through
// the runtime's own socket layer. 1 yes, 0 no, -1 the platform has no answer
// here and the caller should just try.
//
// This exists because on Windows the runtime's connect reaches
// windows.unexpectedStatus for STATUS_CONNECTION_REFUSED rather than
// error.ConnectionRefused, and prints a diagnostic and a stack trace to
// stderr for what is the ordinary answer to "is the daemon up yet". It
// recovers, but the trace lands on the user's console. Asking here first
// means the connect is only ever made to a port that will take it.
//
// Filed upstream as lumen-lang-org/lumen#44; this comes out when a Lumen
// release carries the mapping. Loopback only, deliberately: a blocking
// connect is immediate against 127.0.0.1 and this is never asked about a
// host that could make it wait.
#ifdef _WIN32
static int plat_winsock_ready(void) {
    static int started = 0;
    WSADATA wsa;
    if (started) { return 1; }
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) { return 0; }
    started = 1;
    return 1;
}

int plat_port_open(const char *host, int port) {
    struct sockaddr_in addr;
    SOCKET sock;
    int connected;

    if (host == NULL || port <= 0 || port > 65535) { return -1; }
    if (!plat_winsock_ready()) { return -1; }

    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons((unsigned short)port);
    addr.sin_addr.s_addr = inet_addr(host);
    if (addr.sin_addr.s_addr == INADDR_NONE) { return -1; }

    sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) { return -1; }
    connected = connect(sock, (struct sockaddr *)&addr, (int)sizeof(addr));
    closesocket(sock);
    return connected == 0 ? 1 : 0;
}
#else
int plat_port_open(const char *host, int port) {
    (void)host;
    (void)port;
    return -1;
}
#endif
