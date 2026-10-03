/** Embedded name tables of the import resolver and the name-reference edges (spec §4.2–4.6, appendix C). */

const words = (s: string): ReadonlySet<string> => new Set(s.split(/\s+/).filter(Boolean));

/** Node.js built-in module names (`node:` prefix optional). */
export const NODE_BUILTINS = words(`
  assert assert/strict async_hooks buffer child_process cluster console constants crypto dgram diagnostics_channel dns
  dns/promises domain events fs fs/promises http http2 https inspector module net os path path/posix path/win32
  perf_hooks process punycode querystring readline readline/promises repl stream stream/promises stream/web
  string_decoder sys test timers timers/promises tls trace_events tty url util util/types v8 vm wasi worker_threads zlib
  sqlite sea
`);

/** Python 3.13 `sys.stdlib_module_names` (public names) + removed "dead batteries" still found in old code. */
export const PY_STDLIB = words(`
  __future__ _thread abc aifc annotationlib antigravity argparse array ast asynchat asyncio asyncore atexit audioop base64
  bdb binascii bisect builtins bz2 cProfile calendar cgi cgitb chunk cmath cmd code codecs codeop collections colorsys
  compileall compression concurrent configparser contextlib contextvars copy copyreg crypt csv ctypes curses dataclasses
  datetime dbm decimal difflib dis distutils doctest email encodings ensurepip enum errno faulthandler fcntl filecmp
  fileinput fnmatch fractions ftplib functools gc genericpath getopt getpass gettext glob graphlib grp gzip hashlib heapq
  hmac html http idlelib imaplib imghdr imp importlib inspect io ipaddress itertools json keyword lib2to3 linecache locale
  logging lzma mailbox mailcap marshal math mimetypes mmap modulefinder msilib msvcrt multiprocessing netrc nis nntplib nt
  ntpath nturl2path numbers opcode operator optparse os ossaudiodev pathlib pdb pickle pickletools pipes pkgutil platform
  plistlib poplib posix posixpath pprint profile pstats pty pwd py_compile pyclbr pydoc pydoc_data pyexpat queue quopri
  random re readline reprlib resource rlcompleter runpy sched secrets select selectors shelve shlex shutil signal site
  smtpd smtplib sndhdr socket socketserver spwd sqlite3 sre_compile sre_constants sre_parse ssl stat statistics string
  stringprep struct subprocess sunau symtable sys sysconfig syslog tabnanny tarfile telnetlib tempfile termios textwrap
  this threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle turtledemo types
  typing unicodedata unittest urllib uu uuid venv warnings wave weakref webbrowser winreg winsound wsgiref xdrlib xml
  xmlrpc zipapp zipfile zipimport zlib zoneinfo
`);

/** Import name → distribution name where they differ (spec §4.3-5 [仮]). Keys are import heads (or dotted). */
export const PY_IMPORT_TO_DIST: Readonly<Record<string, string>> = {
  yaml: "PyYAML",
  PIL: "Pillow",
  cv2: "opencv-python",
  sklearn: "scikit-learn",
  bs4: "beautifulsoup4",
  dateutil: "python-dateutil",
  jwt: "PyJWT",
  attr: "attrs",
  "google.protobuf": "protobuf",
};

/** Normalize a Python distribution / import name for comparison (`-`/`_`/`.`, case). */
export function pyNorm(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/** Generic names ignored by the name-reference edges (appendix C [仮]) + language built-ins. */
export const GENERIC_NAMES = words(`
  get set has add put run main init new New String Error Close Open Read Write Flush Reset Len Less Swap
  ReadFile WriteFile len append make copy delete map filter reduce forEach find some every push pop shift
  then catch finally resolve reject log info warn error debug trace print printf println Println Printf
  Sprintf Fprintf Errorf format parse Parse toString valueOf toJSON id name value data key keys values items
  list item index count size length type kind path url uri file dir src dst out in err res req resp ctx cfg
  config options opts args argv props state store render setState useState useEffect useMemo useCallback
  useRef useContext require exports module default test it describe expect assert before after beforeEach
  afterEach self cls this super constructor handle handler callback cb fn next done start stop open close
  create update remove load save fetch send emit on off apply call bind wrap unwrap clone equals hash
  compare sort merge join split trim replace match test exec lower upper min max sum abs floor ceil round
  Object Array Promise Map Set WeakMap WeakSet Symbol Number Boolean Date RegExp JSON Math Reflect Proxy BigInt
  Uint8Array Int32Array Float64Array ArrayBuffer TextEncoder TextDecoder URL URLSearchParams Response Request Headers
  console setTimeout clearTimeout setInterval clearInterval queueMicrotask structuredClone parseInt parseFloat isNaN
  Partial Required Readonly Record Pick Omit Exclude Extract NonNullable ReturnType Parameters Awaited Iterable
  React Fragment useReducer useLayoutEffect
  isinstance issubclass getattr setattr hasattr super str int float bool dict tuple bytes object range enumerate zip
  sorted reversed iter open repr hash Exception ValueError TypeError KeyError RuntimeError NotImplementedError
  dataclass property staticmethod classmethod Optional Union List Dict Tuple Any Callable
  panic recover cap close int64 int32 uint64 float64 byte rune string bool any error Context
  Vec Option Result Some None Ok Err Box Rc Arc String HashMap BTreeMap Clone Debug Default Display Into From
  unwrap expect println format vec write writeln eprintln
`);
