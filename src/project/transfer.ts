import type { SourceFile } from "../build/turboc";
import { normalizeDosName, validateDosName } from "./dosNames";
import { MAX_PROJECT_NAME } from "./store";
import type { ProjectSnapshot } from "./useProject";

/**
 * Projects in and out as files.
 *
 * Everything else here lives in IndexedDB, which is per-browser, per-profile,
 * and cleared along with site data. An export is the only copy of a project the
 * user can actually keep, mail to themselves, or check into a repository, so the
 * format is plain JSON with the file contents inline: legible in an editor,
 * diffable, and repairable by hand if it ever comes to that. A zip would carry
 * the sources more naturally but would lose which tabs were open, and would need
 * a library to read on the way back in.
 *
 * The stored shape was already close to this — files are kept by name and carry
 * no session-scoped ids — so an export is a `StoredProject` minus the parts that
 * only mean something to one browser: its id and its timestamps.
 */

export const EXPORT_FORMAT = "13h.dev/project";

/**
 * Bumped only for a change an older reader would get *wrong*. Adding a field an
 * old reader can ignore does not qualify; `parseExport` accepts anything at or
 * below this and ignores what it doesn't know.
 */
export const EXPORT_VERSION = 1;

export const EXPORT_EXTENSION = ".13h.json";

export interface ExportedProject {
  format: typeof EXPORT_FORMAT;
  version: number;
  name: string;
  files: SourceFile[];
  openNames: string[];
  activeName: string | null;
  /** ISO, and only for whoever opens the file in an editor. Never read back. */
  exportedAt: string;
}

export function toExport(name: string, snapshot: ProjectSnapshot): ExportedProject {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    name,
    files: snapshot.files.map(({ name: fileName, text }) => ({ name: fileName, text })),
    openNames: [...snapshot.openNames],
    activeName: snapshot.activeName,
    exportedAt: new Date().toISOString(),
  };
}

/** Indented because the whole point of JSON here is that a human can read it. */
export const serializeExport = (project: ExportedProject): string =>
  JSON.stringify(project, null, 2);

/**
 * A filename derived from the project's name, which is the user's own label and
 * subject to none of the 8.3 rules — it can hold spaces, punctuation, or nothing
 * usable at all.
 */
export function exportFilename(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    // Trimmed after the slice as well as before it, since cutting to length can
    // itself land on a separator.
    .replace(/^-+|-+$/g, "");
  return `${slug || "project"}${EXPORT_EXTENSION}`;
}

/**
 * Hands the browser a file to save.
 *
 * The anchor has to be in the document for Firefox to honour the click, and the
 * object URL has to outlive it — revoking in the same tick cancels the download
 * in Chrome, which is a fault that only shows up on a fast machine.
 */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads an export back, or throws with something worth showing the user.
 *
 * Every field is checked rather than trusted. This is the one path where data
 * the app never wrote gets turned into a project, and the failure it guards
 * against is not malice but the ordinary mistake of picking the wrong file —
 * which should say so plainly, not surface later as an empty editor or a build
 * that fails on a filename DOS cannot represent.
 */
export function parseExport(text: string): ExportedProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(
      `That file isn't JSON. A project export is the ${EXPORT_EXTENSION} file the export button writes.`,
    );
  }

  if (!isRecord(raw) || raw.format !== EXPORT_FORMAT) {
    throw new Error("That JSON isn't a 13h.dev project export.");
  }

  if (typeof raw.version !== "number" || raw.version > EXPORT_VERSION) {
    throw new Error(
      "That export was written by a newer version of 13h.dev than this one can read.",
    );
  }

  if (!Array.isArray(raw.files) || raw.files.length === 0) {
    throw new Error("That export contains no files.");
  }

  const files: SourceFile[] = [];
  for (const entry of raw.files) {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.text !== "string") {
      throw new Error("That export has a file in it with no name or no contents.");
    }

    // Held to exactly the rules the editor enforces, so an import can never
    // produce a project the app itself would have refused to create.
    const name = normalizeDosName(entry.name);
    const problem = validateDosName(name, files.map((file) => file.name));
    if (problem) throw new Error(`${entry.name}: ${problem}`);

    files.push({ name, text: entry.text });
  }

  const names = new Set(files.map((file) => file.name));
  const known = (value: unknown): value is string =>
    typeof value === "string" && names.has(normalizeDosName(value));

  // Tabs are a convenience, not content: anything unrecognised is dropped
  // quietly rather than made a reason to reject the file.
  const openNames = Array.isArray(raw.openNames)
    ? raw.openNames.filter(known).map(normalizeDosName)
    : [];

  return {
    format: EXPORT_FORMAT,
    version: raw.version,
    name: typeof raw.name === "string" ? raw.name.trim().slice(0, MAX_PROJECT_NAME) : "",
    files,
    openNames,
    activeName: known(raw.activeName) ? normalizeDosName(raw.activeName) : null,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
  };
}

/**
 * Importing the same file twice is a thing people do, so the copy gets a
 * distinguishing suffix rather than becoming the second identically named entry
 * in a switcher that shows nothing but names.
 */
export function uniqueProjectName(
  desired: string,
  // Only the names matter, so that is all this asks for.
  existing: readonly { name: string }[],
): string {
  const taken = new Set(existing.map((project) => project.name.toLowerCase()));
  const base = (desired || "Imported project").slice(0, MAX_PROJECT_NAME);
  if (!taken.has(base.toLowerCase())) return base;

  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = base.slice(0, MAX_PROJECT_NAME - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
