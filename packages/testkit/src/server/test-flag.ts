// `bun --preload` for the daemon subprocess started from source: turns on the test hooks that release builds compile out
// (`globalThis.__MITORI_TEST__`, ARCHITECTURE test routes `/__test/*`).
globalThis.__MITORI_TEST__ = true;
