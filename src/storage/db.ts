/**
 * The one IndexedDB connection everything local goes through.
 *
 * The toolchain and the user's projects live in the same database, so the
 * version number and the upgrade path have to be owned in one place. Two modules
 * each opening "13h.dev" at a version of their own would have the second one
 * fail with a VersionError, or worse, silently block behind the first.
 */

const DB_NAME = "13h.dev";

/**
 * v1 was the toolchain alone. v2 adds projects. Upgrades create only what is
 * missing, so a browser that already has a compiler cached keeps it.
 */
const DB_VERSION = 2;

export const TOOLCHAIN_STORE = "toolchain";
export const PROJECTS_STORE = "projects";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TOOLCHAIN_STORE)) {
        db.createObjectStore(TOOLCHAIN_STORE);
      }
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        // Keyed by the project's own id rather than an auto-increment, so a
        // project can be written back without first looking up what it was.
        db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open the local database."));
  });
}

/**
 * Runs several requests inside one transaction, closing the connection whatever
 * happens.
 *
 * `withStore` below covers a single request, which cannot express
 * read-modify-write: two callers each reading, merging and putting would lose
 * whichever change landed first. IndexedDB transactions are atomic, so issuing
 * both requests here removes that window entirely.
 *
 * Every request must be issued from inside the previous one's callback. Awaiting
 * anything that isn't an IndexedDB request lets the transaction auto-commit out
 * from under the rest of the work, which is why this hands out `resolve` and
 * `reject` rather than taking an async function.
 */
export async function withTransaction<T>(
  store: string,
  mode: IDBTransactionMode,
  operation: (
    store: IDBObjectStore,
    resolve: (value: T) => void,
    reject: (reason: Error) => void,
  ) => void,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Local database transaction aborted."));
      operation(transaction.objectStore(store), resolve, reject);
    });
  } finally {
    db.close();
  }
}

/** Wraps a store operation, closing the connection whatever happens. */
export async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = operation(transaction.objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Local database request failed."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Local database transaction aborted."));
    });
  } finally {
    db.close();
  }
}
