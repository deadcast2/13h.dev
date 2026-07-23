/**
 * What TCC is told to build, and the DOS limits that shape it.
 *
 * Split out from `turboc.ts` because none of it needs an emulator: given a set
 * of files it decides which are translation units, writes the config the
 * compiler reads, and composes the batch file that invokes it. That makes it
 * the part of a build that can be checked without booting DOSBox, which matters
 * because it is also the part carrying the rules that are easy to break by
 * accident and hard to notice — a header compiled as a unit links to nothing,
 * and a command line one character too long is truncated in silence.
 */

export interface SourceFile {
  /** DOS 8.3 filename, e.g. "MAIN.C". */
  name: string;
  text: string;
}

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

export interface CompilerFlags {
  /**
   * Large is the default because mode 13h work constantly reaches for far
   * pointers into video memory at A000:0000, and the smaller models make that
   * needlessly awkward for someone just following along with a book.
   */
  memoryModel?: MemoryModel;
  /** Extra flags appended to TURBOC.CFG verbatim, one per line. */
  extraFlags?: string[];
}

/** Where the sources are mounted, and what the guest calls what it produces. */
export const SRC_DIR = "SRC";
export const OUTPUT_EXE = "MAIN.EXE";
export const LOG_FILE = "BUILD.LOG";
export const DONE_FILE = "DONE.FLG";

/**
 * What TCC is handed on the command line. Headers are written to the same
 * directory so `#include "VGA.H"` resolves, but naming one as a translation unit
 * makes TCC compile it standalone and then hand the linker an object file full
 * of nothing.
 *
 * .ASM belongs here: TCC recognises it and shells out to TASM, so an assembly
 * file is a translation unit in exactly the way a .C file is. Leaving it out is
 * how it once got written to the disk, shown in the tree, and then silently
 * never built.
 */
const TRANSLATION_UNIT = /\.(c|cpp|asm)$/i;

/**
 * COMMAND.COM parses at most 127 characters, and truncates silently past that —
 * the tail of the file list simply never reaches the compiler, and the build
 * fails at link time complaining about symbols whose source is right there in
 * the project. Checked rather than discovered.
 */
export const DOS_COMMAND_LIMIT = 127;

/** DOS tools want CRLF, and DOSBox's shell is particular about it in batch files. */
export const toDos = (text: string) => text.replace(/\r?\n/g, "\r\n");

/** The subset of a project that TCC is given by name. */
export const translationUnits = (sources: SourceFile[]): SourceFile[] =>
  sources.filter((file) => TRANSLATION_UNIT.test(file.name));

/**
 * TCC reads TURBOC.CFG from the current directory automatically. Putting the
 * options here instead of on the command line sidesteps the 127-character DOS
 * command-line limit, which a project with a handful of source files would
 * otherwise blow through.
 */
export function turbocCfg(flags: CompilerFlags = {}): string {
  const lines = [
    "-IC:\\TC\\INCLUDE",
    "-LC:\\TC\\LIB",
    MODEL_FLAG[flags.memoryModel ?? "large"],
    ...(flags.extraFlags ?? []),
  ];
  return toDos(lines.join("\n") + "\n");
}

export function buildBat(units: SourceFile[]): string {
  if (units.length === 0) {
    throw new Error(
      "Nothing to compile — the project has no .C, .CPP or .ASM files.",
    );
  }

  // Compile and link in one invocation; TCC hands the objects to TLINK itself.
  // `TCC` unqualified rather than C:\TC\BIN\TCC.EXE — the toolchain is on PATH
  // either way, and the twelve characters saved are twelve characters of
  // filenames that fit under the command-line limit.
  const command = `TCC -e${OUTPUT_EXE} ${units.map((f) => f.name).join(" ")}`;

  if (command.length + ` > ${LOG_FILE}`.length > DOS_COMMAND_LIMIT) {
    throw new Error(
      `This project has too many source files for one DOS command line ` +
        `(${units.length} files, ${command.length} characters, limit ` +
        `${DOS_COMMAND_LIMIT - 12}). Shorter filenames or fewer of them will fit.`,
    );
  }

  return toDos(
    [
      "@ECHO OFF",
      `${command} > ${LOG_FILE}`,
      // Written last, so its presence means the build has finished. The host
      // polls for this rather than guessing at timing.
      `ECHO DONE > ${DONE_FILE}`,
      "",
    ].join("\n"),
  );
}
