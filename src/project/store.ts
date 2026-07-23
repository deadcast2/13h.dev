import type { SourceFile } from "../build/turboc";
import { PROJECTS_STORE, withStore } from "../storage/db";

/**
 * Local persistence for the user's projects.
 *
 * Files are stored by name rather than by the ids the editor uses. Those ids are
 * only meaningful for the life of a page — they exist so that renaming a file
 * doesn't throw away its Monaco model — and writing them out would mean either
 * restoring a counter alongside them or handing out duplicates after a reload.
 * Names are already unique within a project and already validated, which makes
 * them the natural key, and it keeps the stored shape plain enough to be the
 * basis of the export format in step 6.
 */

export interface StoredProject {
  id: string;
  /** The user's name for it. Not a filename, so not subject to 8.3. */
  name: string;
  files: SourceFile[];
  /** Which files had tabs, by name. Unknown names are ignored on load. */
  openNames: string[];
  activeName: string | null;
  createdAt: number;
  updatedAt: number;
  /** Which project to reopen on the next visit — the last one looked at. */
  lastOpenedAt: number;
}

export function newProject(name: string, files: SourceFile[]): StoredProject {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    files,
    openNames: files.map((file) => file.name),
    activeName: files[0]?.name ?? null,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };
}

/**
 * Writes are queued rather than issued concurrently. Autosave fires on a debounce
 * and a project switch flushes immediately, so two saves can otherwise be in
 * flight at once; each opens its own connection, and nothing then guarantees the
 * later snapshot lands last.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Most recently opened first, which is the order the switcher shows them in. */
export async function listProjects(): Promise<StoredProject[]> {
  const all = await withStore<StoredProject[]>(PROJECTS_STORE, "readonly", (store) =>
    store.getAll(),
  );
  return all.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export function saveProject(project: StoredProject): Promise<void> {
  return enqueue(async () => {
    await withStore(PROJECTS_STORE, "readwrite", (store) => store.put(project));
  });
}

export function deleteProject(id: string): Promise<void> {
  return enqueue(async () => {
    await withStore(PROJECTS_STORE, "readwrite", (store) => store.delete(id));
  });
}
