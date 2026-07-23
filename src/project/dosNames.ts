/**
 * DOS 8.3 filename rules, enforced at the point of naming.
 *
 * The alternative — accepting `player_movement.c` and quietly compiling it as
 * `PLAYER_M.C` — would make every `#include` in the project a lie, and the first
 * time two files collided on the same truncation the failure would surface as a
 * linker error with no connection to the cause. Rejecting the name up front costs
 * one dialog and is exactly what the era's tools did.
 */

/** FAT allows these beyond letters and digits. Not `+ , ; = [ ] " / \ | ? * :`. */
const PUNCTUATION = "$%'-_@~`!(){}^#&";

const ALLOWED = new Set(
  ("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" + PUNCTUATION).split(""),
);

/**
 * Reserved device names. `CON.C` is not a file DOS will let you create — it is
 * the console — and the compiler's complaint about it is memorably unhelpful.
 */
const DEVICES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "CLOCK$",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

export type FileKind = "source" | "header" | "other";

/** DOS is case-insensitive and stores names uppercased; so do we. */
export const normalizeDosName = (raw: string): string => raw.trim().toUpperCase();

export function splitDosName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  return dot === -1
    ? { stem: name, ext: "" }
    : { stem: name.slice(0, dot), ext: name.slice(dot + 1) };
}

export function fileKind(name: string): FileKind {
  const ext = splitDosName(normalizeDosName(name)).ext;
  if (ext === "C" || ext === "CPP") return "source";
  if (ext === "H" || ext === "HPP") return "header";
  return "other";
}

/**
 * Returns a message explaining why `raw` is unusable, or null if it is fine.
 *
 * `taken` is compared case-insensitively, because two files differing only in
 * case are one file as far as the emulated disk is concerned.
 */
export function validateDosName(raw: string, taken: Iterable<string> = []): string | null {
  const name = normalizeDosName(raw);

  if (!name) return "Give the file a name.";
  if (name.includes(" ")) return "DOS filenames cannot contain spaces.";
  if (name.includes("\\") || name.includes("/")) {
    return "Projects are a single flat directory — no subfolders.";
  }

  const dots = name.split(".").length - 1;
  if (dots === 0) return "Add an extension, like MAIN.C or VGA.H.";
  if (dots > 1) return "DOS filenames have exactly one dot.";

  const { stem, ext } = splitDosName(name);

  if (stem.length === 0) return "The part before the dot cannot be empty.";
  if (stem.length > 8) return `"${stem}" is ${stem.length} characters; DOS allows 8.`;
  if (ext.length === 0) return "The part after the dot cannot be empty.";
  if (ext.length > 3) return `".${ext}" is ${ext.length} characters; DOS allows 3.`;

  for (const char of stem + ext) {
    if (!ALLOWED.has(char)) return `"${char}" is not a character DOS allows in a name.`;
  }

  if (DEVICES.has(stem)) return `${stem} is a reserved DOS device name.`;

  for (const other of taken) {
    if (normalizeDosName(other) === name) return `${name} already exists.`;
  }

  return null;
}

/** Sort order for the file list: sources, then headers, alphabetical within. */
const KIND_ORDER: Record<FileKind, number> = { source: 0, header: 1, other: 2 };

export function compareDosNames(a: string, b: string): number {
  const byKind = KIND_ORDER[fileKind(a)] - KIND_ORDER[fileKind(b)];
  return byKind !== 0 ? byKind : normalizeDosName(a).localeCompare(normalizeDosName(b));
}
