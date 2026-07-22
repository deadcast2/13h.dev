import type { CommandInterface, InitFsEntry } from "emulators";

import { loadEmulators } from "../dos/emulators";
import { DEV_TOOLCHAIN_URL } from "../toolchain/devFixture";

/**
 * Drives Turbo C++ 1.01's command-line compiler inside a headless DOSBox.
 *
 * A build boots a throwaway emulator seeded with the toolchain, the project
 * sources, and a generated batch file; DOSBox runs the batch file via [autoexec]
 * and TCC's output is redirected to a file on the emulated disk. When a sentinel
 * file appears, the log and the resulting executable are read back out and the
 * emulator is torn down.
 *
 * Redirecting to a file rather than listening on `onStdout` is deliberate: with
 * `> BUILD.LOG` the guest captures TCC's output verbatim, without the DOSBox
 * banner and shell echoes that the console stream carries. The console is still
 * collected, but only as a fallback for when things go wrong early.
 */

/** Turbo C's memory models. Selects which startup object and runtime library link. */
export type MemoryModel = "tiny" | "small" | "medium" | "compact" | "large" | "huge";

const MODEL_FLAG: Record<MemoryModel, string> = {
  tiny: "-mt",
  small: "-ms",
  medium: "-mm",
  compact: "-mc",
  large: "-ml",
  huge: "-mh",
};

export interface SourceFile {
  /** DOS 8.3 filename, e.g. "MAIN.C". */
  name: string;
  text: string;
}

export interface BuildOptions {
  /**
   * Large is the default because mode 13h work constantly reaches for far
   * pointers into video memory at A000:0000, and the smaller models make that
   * needlessly awkward for someone just following along with a book.
   */
  memoryModel?: MemoryModel;
  /** Extra flags appended to TURBOC.CFG verbatim, one per line. */
  extraFlags?: string[];
  /** Give up after this long. A cold build is normally a few seconds. */
  timeoutMs?: number;
}

export interface BuildResult {
  ok: boolean;
  /** Raw TCC output — compiler banner, warnings and errors. */
  log: string;
  /** The linked DOS executable, or null if the build failed. */
  executable: Uint8Array | null;
  durationMs: number;
}

const SRC_DIR = "SRC";
const OUTPUT_EXE = "MAIN.EXE";
const LOG_FILE = "BUILD.LOG";
const DONE_FILE = "DONE.FLG";

/** DOS tools want CRLF, and DOSBox's shell is particular about it in batch files. */
const toDos = (text: string) => text.replace(/\r?\n/g, "\r\n");

const encode = (text: string) => new TextEncoder().encode(text);

/**
 * Turbo C writes CP437. Decoding as latin1 keeps every byte round-trippable and
 * never throws; the box-drawing characters in the banner come out slightly wrong,
 * but error messages — the part that matters — are plain ASCII.
 */
const decodeDos = (bytes: Uint8Array) => new TextDecoder("iso-8859-1").decode(bytes);

/** DOSBox colourises its console; the escape codes are noise in a build log. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");
const stripAnsi = (text: string) => text.replace(ANSI, "");

/**
 * TCC reads TURBOC.CFG from the current directory automatically. Putting the
 * options here instead of on the command line sidesteps the 127-character DOS
 * command-line limit, which a project with a handful of source files would
 * otherwise blow through.
 */
function turbocCfg(options: BuildOptions): string {
  const lines = [
    "-IC:\\TC\\INCLUDE",
    "-LC:\\TC\\LIB",
    MODEL_FLAG[options.memoryModel ?? "large"],
    ...(options.extraFlags ?? []),
  ];
  return toDos(lines.join("\n") + "\n");
}

function buildBat(sources: SourceFile[]): string {
  const names = sources.map((f) => f.name).join(" ");
  return toDos(
    [
      "@ECHO OFF",
      // Compile and link in one invocation; TCC hands the objects to TLINK itself.
      `C:\\TC\\BIN\\TCC.EXE -e${OUTPUT_EXE} ${names} > ${LOG_FILE}`,
      // Written last, so its presence means the build has finished. The host
      // polls for this rather than guessing at timing.
      `ECHO DONE > ${DONE_FILE}`,
      "",
    ].join("\n"),
  );
}

const DOSBOX_CONF = `
[dosbox]
machine=svga_s3
memsize=16

[cpu]
core=auto
cputype=auto
cycles=max

[autoexec]
mount c .
c:
rem TCC shells out to TLINK by bare name, so the toolchain has to be on PATH.
set PATH=Z:\\;C:\\TC\\BIN
cd \\${SRC_DIR}
CALL BUILD.BAT
`;

type FsNode = Awaited<ReturnType<CommandInterface["fsTree"]>>;

/**
 * Maps UPPERCASED path -> actual path for every file on the emulated disk.
 *
 * Existence has to be checked this way because `fsReadFile` on a path that does
 * not exist never settles — it neither resolves nor rejects, so awaiting it hangs
 * forever and no try/catch can save you. Everything below therefore looks a file
 * up in the tree before daring to read it.
 */
async function listFiles(ci: CommandInterface): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  const walk = (node: FsNode, prefix: string) => {
    for (const child of node.nodes ?? []) {
      const path = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.nodes) walk(child, path);
      else files.set(path.toUpperCase(), path);
    }
  };

  walk(await ci.fsTree(), "");
  return files;
}

/** Read a file only if the tree says it's there. */
async function readIfPresent(
  ci: CommandInterface,
  files: Map<string, string>,
  path: string,
): Promise<Uint8Array | null> {
  const actual = files.get(path.toUpperCase());
  return actual ? await ci.fsReadFile(actual) : null;
}

/**
 * Poll the filesystem tree until the guest drops the sentinel file, meaning the
 * batch script ran to completion. Returns the final listing so callers don't have
 * to walk the tree a second time.
 */
async function awaitCompletion(
  ci: CommandInterface,
  timeoutMs: number,
): Promise<Map<string, string> | null> {
  const deadline = Date.now() + timeoutMs;
  const sentinel = `${SRC_DIR}/${DONE_FILE}`.toUpperCase();

  while (Date.now() < deadline) {
    const files = await listFiles(ci);
    if (files.has(sentinel)) return files;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

export async function compile(
  sources: SourceFile[],
  options: BuildOptions = {},
): Promise<BuildResult> {
  if (sources.length === 0) {
    throw new Error("Nothing to compile — the project has no source files.");
  }

  const startedAt = performance.now();
  const emulators = await loadEmulators();

  const toolchainResponse = await fetch(DEV_TOOLCHAIN_URL);
  if (!toolchainResponse.ok) {
    throw new Error(
      `Toolchain unavailable (${toolchainResponse.status}). ` +
        `Run: npm run toolchain:fixture`,
    );
  }
  const toolchain = new Uint8Array(await toolchainResponse.arrayBuffer());

  const initFs: InitFsEntry[] = [
    // A bare Uint8Array is treated as a zip bundle and extracted into C:.
    toolchain,
    { dosboxConf: DOSBOX_CONF, jsdosConf: { version: emulators.version } },
    { path: `${SRC_DIR}/TURBOC.CFG`, contents: encode(turbocCfg(options)) },
    { path: `${SRC_DIR}/BUILD.BAT`, contents: encode(buildBat(sources)) },
    ...sources.map((file) => ({
      path: `${SRC_DIR}/${file.name}`,
      contents: encode(toDos(file.text)),
    })),
  ];

  const ci = await emulators.dosboxWorker(initFs);

  const consoleOut: string[] = [];
  ci.events().onStdout((chunk) => consoleOut.push(chunk));

  try {
    const files = await awaitCompletion(ci, options.timeoutMs ?? 120_000);

    if (!files) {
      return {
        ok: false,
        log:
          "Build timed out — the compiler never finished.\n\n" +
          "DOS console:\n" +
          stripAnsi(consoleOut.join("")),
        executable: null,
        durationMs: performance.now() - startedAt,
      };
    }

    const logBytes = await readIfPresent(ci, files, `${SRC_DIR}/${LOG_FILE}`);
    const exeBytes = await readIfPresent(ci, files, `${SRC_DIR}/${OUTPUT_EXE}`);

    return {
      // The executable's existence is the ground truth for success. Parsing the
      // log for the word "Error" would be guessing at TCC's phrasing.
      ok: exeBytes !== null,
      log: logBytes
        ? decodeDos(logBytes)
        : `(no compiler output)\n\nDOS console:\n${stripAnsi(consoleOut.join(""))}`,
      executable: exeBytes,
      durationMs: performance.now() - startedAt,
    };
  } finally {
    await ci.exit();
  }
}
