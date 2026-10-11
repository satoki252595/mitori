/* argv-only Windows launcher. The child is assigned to the job before its first instruction;
 * closing our non-inherited job handle always kills every descendant, including after the leader exits.
 * Build only via the repository Nix windowsCross shell. No shell, DLL/plugin loading, or user config. */
#ifndef UNICODE
#define UNICODE 1
#endif
#ifndef _UNICODE
#define _UNICODE 1
#endif
#ifndef WINVER
#define WINVER 0x0A00
#endif
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#if _WIN32_WINNT < 0x0A00
#error Atomic PROC_THREAD_ATTRIBUTE_JOB_LIST requires Windows 10 or newer
#endif
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#define COMMAND_CHARS 32768

static int failure(const char *stage) {
    DWORD error = GetLastError();
    fprintf(stderr, "mitori windows job: %s failed (%lu)\n", stage, (unsigned long)error);
    return 125;
}

static BOOL absolute(const wchar_t *s) {
    return ((s[0] >= L'A' && s[0] <= L'Z') || (s[0] >= L'a' && s[0] <= L'z')) && s[1] == L':' &&
        (s[2] == L'\\' || s[2] == L'/') ? TRUE : s[0] == L'\\' && s[1] == L'\\';
}

static BOOL put(wchar_t *out, size_t *n, wchar_t ch) {
    if (*n >= COMMAND_CHARS - 1) return FALSE;
    out[(*n)++] = ch;
    return TRUE;
}

/* The MS C argv convention: double backslashes before a quote or the closing quote; preserve all other chars. */
static BOOL command_line(wchar_t *out, int argc, wchar_t **argv, int first) {
    size_t n = 0;
    for (int i = first; i < argc; i++) {
        if (i > first && !put(out, &n, L' ')) return FALSE;
        if (!put(out, &n, L'"')) return FALSE;
        const wchar_t *p = argv[i];
        for (;;) {
            size_t slashes = 0;
            while (*p == L'\\') { slashes++; p++; }
            size_t count = (*p == L'"' || *p == L'\0') ? slashes * 2 : slashes;
            for (size_t j = 0; j < count; j++) if (!put(out, &n, L'\\')) return FALSE;
            if (*p == L'\0') break;
            if (*p == L'"' && !put(out, &n, L'\\')) return FALSE;
            if (!put(out, &n, *p++)) return FALSE;
        }
        if (!put(out, &n, L'"')) return FALSE;
    }
    out[n] = L'\0';
    return TRUE;
}

/* Bun adds Windows defaults to the launcher's environment. Copy only explicitly requested names to the child. */
static int environment_name_order(const void *a, const void *b) {
    return CompareStringOrdinal(*(const wchar_t * const *)a, -1, *(const wchar_t * const *)b, -1, TRUE) - CSTR_EQUAL;
}

static LPWCH child_environment(int count, wchar_t **names) {
    LPWCH inherited = GetEnvironmentStringsW();
    if (!inherited) return NULL;
    size_t chars = 2;
    for (const wchar_t *p = inherited; *p; p += wcslen(p) + 1) chars += wcslen(p) + 1;
    LPWCH env = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, chars * sizeof(wchar_t));
    if (!env) { FreeEnvironmentStringsW(inherited); SetLastError(ERROR_NOT_ENOUGH_MEMORY); return NULL; }
    /* Windows requires a case-insensitive Unicode ordinal sort, independent of the user's locale. */
    qsort(names, (size_t)count, sizeof(*names), environment_name_order);
    size_t n = 0;
    for (int i = 0; i < count; i++) {
        const wchar_t *name = names[i];
        size_t len = wcslen(name);
        if (!len || wcschr(name, L'=') || (i > 0 && environment_name_order(&names[i - 1], &names[i]) == 0)) goto invalid;
        const wchar_t *value = NULL;
        for (const wchar_t *p = inherited; *p; p += wcslen(p) + 1) {
            const wchar_t *sep = wcschr(p, L'=');
            if (sep && (size_t)(sep - p) == len && CompareStringOrdinal(p, (int)len, name, (int)len, TRUE) == CSTR_EQUAL) {
                value = sep;
                break;
            }
        }
        if (!value) goto invalid;
        size_t tail = wcslen(value) + 1;
        if (n + len + tail >= chars) goto invalid;
        memcpy(env + n, name, len * sizeof(wchar_t));
        n += len;
        memcpy(env + n, value, tail * sizeof(wchar_t));
        n += tail;
    }
    /* HEAP_ZERO_MEMORY leaves both NUL terminators even for the empty environment. */
    FreeEnvironmentStringsW(inherited);
    return env;
invalid:
    FreeEnvironmentStringsW(inherited);
    HeapFree(GetProcessHeap(), 0, env);
    SetLastError(ERROR_INVALID_PARAMETER);
    return NULL;
}

int wmain(int argc, wchar_t **argv) {
    int count = 0;
    if (argc < 5 || wcscmp(argv[1], L"--env-count") != 0 || !argv[2][0]) goto invalid_arguments;
    for (const wchar_t *p = argv[2]; *p; p++) {
        if (*p < L'0' || *p > L'9' || count > argc) goto invalid_arguments;
        count = count * 10 + (*p - L'0');
    }
    int first = count + 4;
    if (count > argc - 5 || wcscmp(argv[first - 1], L"--") != 0 || wcslen(argv[first]) < 3 || !absolute(argv[first])) {
invalid_arguments:
        fprintf(stderr, "mitori windows job: explicit environment names, an absolute executable and literal argv are required\n");
        return 125;
    }
    wchar_t *line = HeapAlloc(GetProcessHeap(), 0, COMMAND_CHARS * sizeof(wchar_t));
    if (!line) return failure("command allocation");
    if (!command_line(line, argc, argv, first)) {
        fprintf(stderr, "mitori windows job: command exceeds Windows' UTF-16 command-line limit\n");
        HeapFree(GetProcessHeap(), 0, line);
        return 125;
    }
    HANDLE job = CreateJobObjectW(NULL, NULL);
    if (!job) { int code = failure("CreateJobObjectW"); HeapFree(GetProcessHeap(), 0, line); return code; }
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limit = {0};
    limit.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limit, sizeof(limit))) {
        int code = failure("job limit"); CloseHandle(job); HeapFree(GetProcessHeap(), 0, line); return code;
    }

    /* Duplicate only the three standard handles as inheritable. The job and every other handle stay private. */
    HANDLE io[3] = {NULL, NULL, NULL};
    DWORD standard[3] = {STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE};
    int status = 125;
    PPROC_THREAD_ATTRIBUTE_LIST attrs = NULL;
    LPWCH env = NULL;
    for (int i = 0; i < 3; i++) {
        HANDLE source = GetStdHandle(standard[i]);
        if (!source || source == INVALID_HANDLE_VALUE ||
            !DuplicateHandle(GetCurrentProcess(), source, GetCurrentProcess(), &io[i], 0, TRUE, DUPLICATE_SAME_ACCESS)) {
            status = failure("standard handle"); goto cleanup;
        }
    }
    SIZE_T size = 0;
    InitializeProcThreadAttributeList(NULL, 2, 0, &size);
    attrs = HeapAlloc(GetProcessHeap(), 0, size);
    if (!attrs) { status = failure("attribute allocation"); goto cleanup; }
    if (!InitializeProcThreadAttributeList(attrs, 2, 0, &size)) {
        status = failure("attribute initialization");
        HeapFree(GetProcessHeap(), 0, attrs); attrs = NULL;
        goto cleanup;
    }
    if (!UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, io, sizeof(io), NULL, NULL) ||
        !UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST, &job, sizeof(job), NULL, NULL)) {
        status = failure("atomic job/handle attributes (Windows 10+ required)"); goto cleanup;
    }
    env = child_environment(count, argv + 3);
    if (!env) { status = failure("child environment"); goto cleanup; }
    STARTUPINFOEXW start = {0};
    start.StartupInfo.cb = sizeof(start);
    start.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    start.StartupInfo.hStdInput = io[0];
    start.StartupInfo.hStdOutput = io[1];
    start.StartupInfo.hStdError = io[2];
    start.lpAttributeList = attrs;
    PROCESS_INFORMATION child = {0};
    if (!CreateProcessW(argv[first], line, NULL, NULL, TRUE,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
            env, NULL, &start.StartupInfo, &child)) {
        status = failure("CreateProcessW"); goto cleanup;
    }
    CloseHandle(child.hThread);
    if (WaitForSingleObject(child.hProcess, INFINITE) != WAIT_OBJECT_0) status = failure("leader wait");
    else {
        DWORD code;
        if (!GetExitCodeProcess(child.hProcess, &code)) status = failure("leader exit code");
        else status = (int)code;
    }
    CloseHandle(child.hProcess);
    /* No BREAKAWAY_OK or SILENT_BREAKAWAY_OK: nested process groups cannot escape this job. */
cleanup:
    if (env) HeapFree(GetProcessHeap(), 0, env);
    if (attrs) { DeleteProcThreadAttributeList(attrs); HeapFree(GetProcessHeap(), 0, attrs); }
    for (int i = 0; i < 3; i++) if (io[i]) CloseHandle(io[i]);
    CloseHandle(job);
    HeapFree(GetProcessHeap(), 0, line);
    return status;
}
