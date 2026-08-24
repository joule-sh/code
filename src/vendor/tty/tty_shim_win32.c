// The Win32 half of the tty shim. Same nine scalar-in/scalar-out entry points
// as tty_shim.c, so src/vendor/tty/tty.ts declares one FFI surface and never
// learns which platform it is on; the Makefile picks the file.
//
// Three things differ from termios and none of them are cosmetic.
//
// Raw mode is a console mode word rather than a struct, and the flags that
// matter live on two handles: input loses line buffering and echo and gains
// ENABLE_VIRTUAL_TERMINAL_INPUT, which is what makes conhost hand us the same
// escape sequences a POSIX terminal would; output gains
// ENABLE_VIRTUAL_TERMINAL_PROCESSING, without which the cursor addressing and
// SGR the renderer writes are printed literally on a stock console. Both are
// saved and put back by raw_disable, along with the two code pages, which are
// moved to UTF-8 so the box drawing survives the trip.
//
// Reading is the part with no direct translation. POSIX poll() answers "is a
// byte ready" for a terminal, a pipe and a file alike; the console handle's
// wait state does not, because it is signalled by focus changes and mouse
// movement that produce no bytes at all, and a ReadFile that follows one of
// those blocks forever. So each fd gets a thread that does nothing but block
// in ReadFile and push what it gets into a ring, and the timeout is taken on a
// semaphore counting bytes actually available. That is also what makes the
// test pipe below behave: an idle anonymous pipe times out instead of
// returning EOF.
//
// Build:
//   zig cc -target x86_64-windows-gnu -c tty_shim_win32.c -o tty_shim.o

#include <windows.h>
#include <io.h>
#include <fcntl.h>

#ifndef ENABLE_VIRTUAL_TERMINAL_INPUT
#define ENABLE_VIRTUAL_TERMINAL_INPUT 0x0200
#endif
#ifndef ENABLE_VIRTUAL_TERMINAL_PROCESSING
#define ENABLE_VIRTUAL_TERMINAL_PROCESSING 0x0004
#endif

#define TTY_RING 4096
#define TTY_MAX_READERS 8

// One reader per fd, created on first read and never torn down: a thread
// parked in ReadFile cannot be cancelled, and process exit collects them.
typedef struct {
    int in_use;
    int fd;
    HANDLE handle;
    HANDLE data;
    HANDLE space;
    CRITICAL_SECTION lock;
    unsigned char buf[TTY_RING];
    int head;
    int tail;
    int ended;
    int failed;
} tty_reader;

static tty_reader g_readers[TTY_MAX_READERS];
static CRITICAL_SECTION g_table_lock;
static INIT_ONCE g_table_once = INIT_ONCE_STATIC_INIT;

static BOOL CALLBACK tty_init_table(PINIT_ONCE once, PVOID param, PVOID *ctx) {
    (void)once; (void)param; (void)ctx;
    InitializeCriticalSection(&g_table_lock);
    return TRUE;
}

static void tty_ensure_table(void) {
    InitOnceExecuteOnce(&g_table_once, tty_init_table, NULL, NULL);
}

// The standard three are asked of the process rather than of the CRT. A Lumen
// binary is linked by Zig, whose startup does not populate the CRT's file
// descriptor table, so _get_osfhandle(0) has nothing to answer with and the
// renderer's isatty(0) came back false inside a real pseudoconsole. The fds
// this shim opens itself - the test pipe, NUL - are CRT fds and do resolve
// that way, which is why both paths are here.
static HANDLE tty_handle(int fd) {
    switch (fd) {
    case 0: return GetStdHandle(STD_INPUT_HANDLE);
    case 1: return GetStdHandle(STD_OUTPUT_HANDLE);
    case 2: return GetStdHandle(STD_ERROR_HANDLE);
    default: break;
    }
    intptr_t h = _get_osfhandle(fd);
    if (h == -1 || h == -2) {
        return INVALID_HANDLE_VALUE;
    }
    return (HANDLE)h;
}

static int tty_is_console(HANDLE h) {
    DWORD mode = 0;
    if (h == INVALID_HANDLE_VALUE) {
        return 0;
    }
    return GetConsoleMode(h, &mode) ? 1 : 0;
}

static DWORD WINAPI tty_reader_thread(LPVOID param) {
    tty_reader *r = (tty_reader *)param;
    for (;;) {
        unsigned char c;
        DWORD n = 0;
        BOOL ok = ReadFile(r->handle, &c, 1, &n, NULL);
        if (!ok || n == 0) {
            EnterCriticalSection(&r->lock);
            if (ok) {
                r->ended = 1;
            } else {
                r->failed = 1;
            }
            LeaveCriticalSection(&r->lock);
            ReleaseSemaphore(r->data, 1, NULL);
            return 0;
        }
        WaitForSingleObject(r->space, INFINITE);
        EnterCriticalSection(&r->lock);
        r->buf[r->tail] = c;
        r->tail = (r->tail + 1) % TTY_RING;
        LeaveCriticalSection(&r->lock);
        ReleaseSemaphore(r->data, 1, NULL);
    }
}

static tty_reader *tty_reader_for(int fd) {
    HANDLE h = tty_handle(fd);
    if (h == INVALID_HANDLE_VALUE) {
        return NULL;
    }
    tty_ensure_table();
    EnterCriticalSection(&g_table_lock);
    tty_reader *found = NULL;
    for (int i = 0; i < TTY_MAX_READERS; i++) {
        if (g_readers[i].in_use && g_readers[i].fd == fd) {
            found = &g_readers[i];
            break;
        }
    }
    if (found == NULL) {
        for (int i = 0; i < TTY_MAX_READERS; i++) {
            if (!g_readers[i].in_use) {
                found = &g_readers[i];
                break;
            }
        }
        if (found != NULL) {
            found->in_use = 1;
            found->fd = fd;
            found->handle = h;
            found->head = 0;
            found->tail = 0;
            found->ended = 0;
            found->failed = 0;
            found->data = CreateSemaphore(NULL, 0, TTY_RING + 1, NULL);
            found->space = CreateSemaphore(NULL, TTY_RING - 1, TTY_RING, NULL);
            InitializeCriticalSection(&found->lock);
            HANDLE t = CreateThread(NULL, 0, tty_reader_thread, found, 0, NULL);
            if (t == NULL) {
                found->in_use = 0;
                found = NULL;
            } else {
                CloseHandle(t);
            }
        }
    }
    LeaveCriticalSection(&g_table_lock);
    return found;
}

// Take one byte the reader has already banked, or report the end it hit.
// The end is sticky: the semaphore is released again on the way out so every
// later call sees it too, rather than the first caller consuming the news.
static int tty_take(tty_reader *r) {
    int out;
    EnterCriticalSection(&r->lock);
    if (r->head != r->tail) {
        out = (int)r->buf[r->head];
        r->head = (r->head + 1) % TTY_RING;
        LeaveCriticalSection(&r->lock);
        ReleaseSemaphore(r->space, 1, NULL);
        return out;
    }
    out = r->failed ? -2 : -1;
    LeaveCriticalSection(&r->lock);
    ReleaseSemaphore(r->data, 1, NULL);
    return out;
}

int tty_isatty(int fd) {
    return tty_is_console(tty_handle(fd)) ? 1 : 0;
}

static DWORD g_saved_in;
static DWORD g_saved_out;
static UINT g_saved_cp_in;
static UINT g_saved_cp_out;
static HANDLE g_saved_out_handle;
static int g_have_saved = 0;

int tty_raw_enable(int fd) {
    HANDLE in = tty_handle(fd);
    if (!tty_is_console(in)) {
        return -1;
    }
    if (!GetConsoleMode(in, &g_saved_in)) {
        return -1;
    }
    DWORD raw = g_saved_in;
    raw &= ~(DWORD)(ENABLE_LINE_INPUT | ENABLE_ECHO_INPUT | ENABLE_PROCESSED_INPUT);
    raw |= ENABLE_VIRTUAL_TERMINAL_INPUT | ENABLE_EXTENDED_FLAGS | ENABLE_MOUSE_INPUT;
    raw &= ~(DWORD)ENABLE_QUICK_EDIT_MODE;
    if (!SetConsoleMode(in, raw)) {
        return -1;
    }

    // Output is a different handle and may not be a console at all when stdout
    // is redirected, which is a normal way to run this and not a failure: the
    // input side is already raw, so the call succeeds and only the VT-output
    // half is skipped.
    g_saved_out_handle = GetStdHandle(STD_OUTPUT_HANDLE);
    g_saved_out = 0;
    if (tty_is_console(g_saved_out_handle)) {
        GetConsoleMode(g_saved_out_handle, &g_saved_out);
        SetConsoleMode(g_saved_out_handle, g_saved_out | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
    } else {
        g_saved_out_handle = INVALID_HANDLE_VALUE;
    }

    g_saved_cp_in = GetConsoleCP();
    g_saved_cp_out = GetConsoleOutputCP();
    SetConsoleCP(CP_UTF8);
    SetConsoleOutputCP(CP_UTF8);

    g_have_saved = 1;
    return 0;
}

int tty_raw_disable(int fd) {
    if (!g_have_saved) {
        return -1;
    }
    HANDLE in = tty_handle(fd);
    if (in == INVALID_HANDLE_VALUE || !SetConsoleMode(in, g_saved_in)) {
        return -1;
    }
    if (g_saved_out_handle != INVALID_HANDLE_VALUE) {
        SetConsoleMode(g_saved_out_handle, g_saved_out);
    }
    SetConsoleCP(g_saved_cp_in);
    SetConsoleOutputCP(g_saved_cp_out);
    g_have_saved = 0;
    return 0;
}

int tty_read_byte(int fd) {
    tty_reader *r = tty_reader_for(fd);
    if (r == NULL) {
        return -2;
    }
    WaitForSingleObject(r->data, INFINITE);
    return tty_take(r);
}

int tty_read_byte_timeout(int fd, int timeout_ms) {
    tty_reader *r = tty_reader_for(fd);
    if (r == NULL) {
        return -2;
    }
    DWORD wait = timeout_ms < 0 ? INFINITE : (DWORD)timeout_ms;
    if (WaitForSingleObject(r->data, wait) == WAIT_TIMEOUT) {
        return -3;
    }
    return tty_take(r);
}

// The size question is asked of stdin, because that is the fd the renderer
// holds, but a console's dimensions live on its screen buffer and stdin has
// none. Falling back to stdout answers what was actually meant; the console
// check on the way in keeps a pipe reporting -1 as it does on POSIX.
static int tty_screen_info(int fd, CONSOLE_SCREEN_BUFFER_INFO *info) {
    HANDLE h = tty_handle(fd);
    if (!tty_is_console(h)) {
        return 0;
    }
    if (GetConsoleScreenBufferInfo(h, info)) {
        return 1;
    }
    HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
    return GetConsoleScreenBufferInfo(out, info) ? 1 : 0;
}

int tty_cols(int fd) {
    CONSOLE_SCREEN_BUFFER_INFO info;
    if (!tty_screen_info(fd, &info)) {
        return -1;
    }
    return (int)(info.srWindow.Right - info.srWindow.Left + 1);
}

int tty_rows(int fd) {
    CONSOLE_SCREEN_BUFFER_INFO info;
    if (!tty_screen_info(fd, &info)) {
        return -1;
    }
    return (int)(info.srWindow.Bottom - info.srWindow.Top + 1);
}

int tty_open_devnull_for_test(void) {
    return _open("NUL", _O_RDONLY | _O_BINARY);
}

static int g_test_pipe_write_fd = -1;

int tty_open_test_pipe(void) {
    int fds[2];
    if (_pipe(fds, TTY_RING, _O_BINARY) != 0) {
        return -1;
    }
    g_test_pipe_write_fd = fds[1];
    return fds[0];
}

int tty_write_byte_to_test_pipe(int byte) {
    if (g_test_pipe_write_fd < 0) {
        return -1;
    }
    unsigned char c = (unsigned char)byte;
    if (_write(g_test_pipe_write_fd, &c, 1) != 1) {
        return -1;
    }
    return 1;
}
