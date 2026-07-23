/**
 * Turns what the toolchain printed into something that can be pointed at a line.
 *
 * The build log is TCC's own words and stays that way — this reads it, it does
 * not replace it. Everything here was written against real output captured from
 * real failing builds rather than from the manual, because three different
 * programs write to that log and they do not agree on a format:
 *
 *   Error main.c 5: Declaration syntax error in function main
 *   Error: Undefined symbol _missing_thing in module main.c
 *   **Error** clear.ASM(2) Code or data emission to undeclared segment
 *
 * The compiler names the file lower-cased, the assembler keeps whatever case it
 * was given, and neither matches the upper-case 8.3 names the project holds. Any
 * matching against project files has to be case-insensitive; see `locate`.
 */

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  /** The file as the tool named it, or null when it named none. */
  file: string | null;
  /** 1-based. Null for a diagnostic about the build rather than a place in it. */
  line: number | null;
  message: string;
}

/**
 * `Error main.c 5: message` — the C compiler, and the only one of the three
 * that gives a file and a line in the form anyone would expect.
 *
 * The file is `\S+` rather than something stricter because it is echoed back
 * from the command line, and an error inside an included header names the
 * header: `Error VGA.H 3: ) expected`.
 */
const COMPILER = /^(Error|Warning|Fatal) (\S+) (\d+): (.+)$/;

/**
 * `**Error** clear.ASM(2) message` — Turbo Assembler.
 *
 * Distinctive enough to test first, which also keeps it away from TASM's own
 * summary lines ("Error messages:    4") that would otherwise have to be
 * excluded by hand.
 */
const ASSEMBLER = /^\*\*(Error|Warning|Fatal)\*\* (\S+)\((\d+)\)\s+(.+)$/;

/**
 * `Error: message` — the linker, and anything that failed before it could reach
 * a line of source. Never has a line number; TLINK's undefined-symbol message
 * names the module it was referenced from, which is the most that can be said
 * about where it came from.
 */
const UNPLACED = /^(Error|Warning|Fatal): (.+)$/;

/** TLINK's way of saying which translation unit a missing symbol came from. */
const IN_MODULE = / in module (\S+)$/;

/** Fatal is how bad it is, not a third thing to render. */
const severityOf = (word: string): DiagnosticSeverity =>
  word === "Warning" ? "warning" : "error";

/**
 * Reads every diagnostic out of a build log, in the order the tools reported
 * them.
 *
 * Lines that are not diagnostics are ignored rather than guessed at — the
 * compiler banner, the per-file echo, and the summary counts ("*** 5 errors in
 * Compile ***", "Error messages:    4") all carry no location and say nothing
 * the individual messages have not already said.
 */
export function parseDiagnostics(log: string): Diagnostic[] {
  const found: Diagnostic[] = [];

  for (const raw of log.split("\n")) {
    const line = raw.replace(/\r$/, "").trim();
    if (!line) continue;

    const assembler = ASSEMBLER.exec(line);
    if (assembler) {
      found.push({
        severity: severityOf(assembler[1]),
        file: assembler[2],
        line: Number(assembler[3]),
        message: assembler[4],
      });
      continue;
    }

    const compiler = COMPILER.exec(line);
    if (compiler) {
      found.push({
        severity: severityOf(compiler[1]),
        file: compiler[2],
        line: Number(compiler[3]),
        message: compiler[4],
      });
      continue;
    }

    const unplaced = UNPLACED.exec(line);
    if (unplaced) {
      const message = unplaced[2];
      found.push({
        severity: severityOf(unplaced[1]),
        // Enough to open the right file, which is worth having even without a
        // line to go to.
        file: IN_MODULE.exec(message)?.[1] ?? null,
        line: null,
        message,
      });
    }
  }

  return found;
}

/**
 * Matches a diagnostic's filename against the project's, case-insensitively.
 *
 * TCC lower-cases what it echoes and TASM does not, so a project holding
 * MAIN.C and CLEAR.ASM is told about `main.c` and `clear.ASM` in the same
 * build. Comparing exactly would put markers on neither.
 */
export function locate<T extends { name: string }>(
  diagnostic: Diagnostic,
  files: readonly T[],
): T | null {
  if (!diagnostic.file) return null;
  const wanted = diagnostic.file.toUpperCase();
  return files.find((file) => file.name.toUpperCase() === wanted) ?? null;
}

/**
 * Whether anything in here means the build did not work.
 *
 * Turbo Link writes MAIN.EXE *and then* reports undefined symbols, leaving an
 * executable of exactly the size a clean build produces with a call whose target
 * was never resolved. The presence of a file on the emulated disk is therefore
 * not evidence that the build succeeded, which is what it was taken for until
 * these diagnostics existed to say otherwise.
 */
export const hasErrors = (diagnostics: readonly Diagnostic[]): boolean =>
  diagnostics.some((diagnostic) => diagnostic.severity === "error");

export function countBySeverity(diagnostics: readonly Diagnostic[]): {
  errors: number;
  warnings: number;
} {
  return {
    errors: diagnostics.filter((d) => d.severity === "error").length,
    warnings: diagnostics.filter((d) => d.severity === "warning").length,
  };
}

/**
 * "3 errors, 1 warning" for the status bar, or null when there is nothing to
 * say. Lives here rather than beside the list that displays it: a module
 * exporting both a component and a plain function cannot be hot-reloaded, and
 * this is a plain function over diagnostics like everything else in this file.
 */
export function diagnosticSummary(diagnostics: readonly Diagnostic[]): string | null {
  const { errors, warnings } = countBySeverity(diagnostics);
  const parts: string[] = [];
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(", ") : null;
}
