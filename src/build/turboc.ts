import type { CommandInterface, InitFsEntry } from "emulators";

import { emulatorLock } from "../dos/emulatorLock";
import { loadEmulators } from "../dos/emulators";
import { copyForEmulator } from "../dos/initFs";
import { loadToolchain } from "../toolchain/store";
import { hasErrors, parseDiagnostics, type Diagnostic } from "./diagnostics";
import {
  buildBat,
  DONE_FILE,
  LOG_FILE,
  OUTPUT_EXE,
  SRC_DIR,
  toDos,
  translationUnits,
  turbocCfg,
  type CompilerFlags,
  type SourceFile,
} from "./commandLine";

// Re-exported from their old home so the rest of the app is untouched by the
// split; a source file is a project-level idea, not an emulator one.
export type { MemoryModel, SourceFile } from "./commandLine";

/**
 * Drives Turbo C++'s command-line compiler inside a headless DOSBox.
 *
 * Works with both 1.01 and 3.0. The flags, TURBOC.CFG and C0x.OBJ/Cx.LIB naming
 * are unchanged between them; 3.0 differs only in needing extended memory, since
 * its compiler runs in protected mode.
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

export interface BuildOptions extends CompilerFlags {
  /** Give up after this long. A cold build is normally a few seconds. */
  timeoutMs?: number;
}

export interface BuildResult {
  ok: boolean;
  /** Raw TCC output — compiler banner, warnings and errors. */
  log: string;
  /**
   * The same failures, read out of the log so they can be pointed at a line.
   * Beside the log rather than instead of it: this is our reading of what the
   * compiler said, and the compiler's own words stay available next to it.
   *
   * Present on a successful build too — warnings are worth showing when nothing
   * failed, and that is the only time anyone is likely to read them.
   */
  diagnostics: Diagnostic[];
  /**
   * An explanation for a failure the compiler reports accurately but obscurely.
   * Kept beside the log rather than spliced into it: the log is TCC's own words
   * and stays that way.
   */
  hint: string | null;
  /** The linked DOS executable, or null if the build failed. */
  executable: Uint8Array | null;
  durationMs: number;
}

/**
 * TCC's complaint when it needs to assemble and cannot. It reaches for TASM both
 * for a .ASM file named on the command line and — on 1.01, which has no built-in
 * assembler — for any inline `asm` block. The message names a program the user
 * never mentioned and gives no clue that it was never theirs to have.
 */
const ASSEMBLER_MISSING = /Unable to execute command 'tasm\.exe'/i;

const NO_ASSEMBLER_HINT =
  "This build needs an assembler and none is installed. TASM.EXE was sold " +
  "separately as Turbo Assembler, so it is on none of the Turbo C++ disks — " +
  "supply a copy alongside them and it will be picked up automatically. " +
  "Failing that, Turbo C++ 3.0 assembles inline `asm` blocks itself; 1.01 " +
  "cannot, and wants pseudo-registers with geninterrupt(), or int86().";

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

const DOSBOX_CONF = `
[dosbox]
machine=svga_s3
memsize=16

[cpu]
core=auto
cputype=auto
cycles=max

[dos]
# Turbo C++ 3.0's compiler runs in protected mode via a DPMI server, which needs
# extended memory. 1.01's is real-mode and indifferent to this.
xms=true
ems=true
umb=true

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
  // Both of these throw for a reason the user can act on — nothing to compile,
  // or a command line DOS would truncate — and both are settled here, before an
  // emulator or a toolchain is loaded, so a bad project fails instantly rather
  // than after a boot.
  const units = translationUnits(sources);
  const batch = buildBat(units);

  const startedAt = performance.now();
  const emulators = await loadEmulators();

  const toolchain = await loadToolchain();
  if (!toolchain) {
    throw new Error(
      "No Turbo C++ toolchain installed. Supply your install disks to set one up.",
    );
  }

  const initFs: InitFsEntry[] = [
    // A bare Uint8Array is treated as a zip bundle and extracted into C:.
    toolchain.zip,
    { dosboxConf: DOSBOX_CONF, jsdosConf: { version: emulators.version } },
    { path: `${SRC_DIR}/TURBOC.CFG`, contents: encode(turbocCfg(options)) },
    { path: `${SRC_DIR}/BUILD.BAT`, contents: encode(batch) },
    // Every file goes to the disk, units and headers alike; only the units are
    // named on the command line.
    ...sources.map((file) => ({
      path: `${SRC_DIR}/${file.name}`,
      contents: encode(toDos(file.text)),
    })),
  ];

  // Copied on the way in so the toolchain buffer survives; step 3 will serve it
  // from a cache rather than a fresh fetch, at which point reusing it is the
  // normal case rather than the exception.
  //
  // Queued because a preview started right after a build would otherwise boot
  // while this instance is still tearing down, and come up dead.
  const ci = await emulatorLock.run(() =>
    emulators.dosboxWorker(copyForEmulator(initFs)),
  );

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
        hint: null,
        diagnostics: [],
        executable: null,
        durationMs: performance.now() - startedAt,
      };
    }

    const logBytes = await readIfPresent(ci, files, `${SRC_DIR}/${LOG_FILE}`);
    const exeBytes = await readIfPresent(ci, files, `${SRC_DIR}/${OUTPUT_EXE}`);

    const log = logBytes
      ? decodeDos(logBytes)
      : `(no compiler output)\n\nDOS console:\n${stripAnsi(consoleOut.join(""))}`;

    const diagnostics = parseDiagnostics(log);

    /*
     * Both conditions are needed, and the second was learned the hard way.
     *
     * The executable's existence used to be the whole test, on the reasoning
     * that reading the log would mean guessing at TCC's phrasing. But TLINK
     * writes MAIN.EXE before it reports undefined symbols: a program calling a
     * function that does not exist links to a file the same size as a working
     * one, and the build reported success and then ran it. Now that the log is
     * parsed rather than pattern-matched, it is the better witness.
     */
    const ok = exeBytes !== null && !hasErrors(diagnostics);

    return {
      ok,
      log,
      hint: ASSEMBLER_MISSING.test(log) ? NO_ASSEMBLER_HINT : null,
      diagnostics,
      // Withheld unless the build worked. What TLINK leaves behind after a
      // failed link is debris, not something anyone should be able to run.
      executable: ok ? exeBytes : null,
      durationMs: performance.now() - startedAt,
    };
  } finally {
    await emulatorLock.run(() => ci.exit());
  }
}
