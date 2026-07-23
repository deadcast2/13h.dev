import type { SourceFile } from "../build/turboc";
import { PROJECTS_STORE, withStore, withTransaction } from "../storage/db";

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

/**
 * Project names are the user's own labels — they never reach DOS, so they are
 * held only to being non-empty and short enough to read in a toolbar. Both the
 * rename field and an imported name are capped here so neither can produce a
 * project the other would have refused.
 */
export const MAX_PROJECT_NAME = 40;

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

/** Writes a whole record. Only right when there is nothing there to preserve. */
export function saveProject(project: StoredProject): Promise<void> {
  return enqueue(async () => {
    await withStore(PROJECTS_STORE, "readwrite", (store) => store.put(project));
  });
}

/**
 * Merges `changes` into a stored project, and returns what it became.
 *
 * This exists so that the two things writing to a project never write the same
 * fields. The workbench owns its contents and autosaves them continuously; the
 * project list owns the name and which project was last opened. Both used to
 * write the whole record, each built from a read taken moments earlier, so
 * either could quietly undo the other — a rename could restore file contents
 * from before the last few keystrokes, and opening a project could do the same.
 *
 * The read and the write share one transaction, so nothing interleaves; the
 * queue then keeps them ordered against the plain writes above. Returns null if
 * the project has since been deleted, which must not resurrect it.
 */
export function updateProject(
  id: string,
  changes: Partial<StoredProject>,
): Promise<StoredProject | null> {
  return enqueue(() =>
    withTransaction<StoredProject | null>(
      PROJECTS_STORE,
      "readwrite",
      (store, resolve, reject) => {
        const read = store.get(id);
        read.onerror = () =>
          reject(read.error ?? new Error("Could not read the project."));
        read.onsuccess = () => {
          const existing = read.result as StoredProject | undefined;
          if (!existing) {
            resolve(null);
            return;
          }

          const updated = { ...existing, ...changes, id: existing.id };
          const write = store.put(updated);
          write.onerror = () =>
            reject(write.error ?? new Error("Could not save the project."));
          write.onsuccess = () => resolve(updated);
        };
      },
    ),
  );
}

export function deleteProject(id: string): Promise<void> {
  return enqueue(async () => {
    await withStore(PROJECTS_STORE, "readwrite", (store) => store.delete(id));
  });
}
