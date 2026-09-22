import type { StateStorage } from "zustand/middleware";
import { withProjectFolders } from "./project-library-client.ts";

export const PROJECT_STORAGE_ERROR_EVENT = "premiere316:project-storage-error";
let saveStatus: "idle" | "saving" | "saved" | "error" = "idle";
let queuedSaves = 0;
let saveFailed = false;
const saveListeners = new Set<() => void>();
export const getProjectSaveStatus = () => saveStatus;
export const subscribeProjectSaveStatus = (listener: () => void) => {
  saveListeners.add(listener);
  return () => {
    saveListeners.delete(listener);
  };
};
function publishSaveStatus(next: typeof saveStatus) {
  saveStatus = next;
  for (const listener of saveListeners) {
    try {
      listener();
    } catch {
      /* A view subscriber cannot prevent a storage operation. */
    }
  }
}
const DATABASE_NAME = "premiere316-projects";
const OBJECT_STORE = "state";

export type ProjectStorageError = {
  operation: "read" | "write" | "remove";
  key: string;
  message: string;
  cause: unknown;
};

/** String storage; Zustand owns JSON serialization and its existing key/version. */
export type ProjectStorageBackend = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

type LegacyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ProjectStorageOptions = {
  /** Injection points also allow deterministic tests without a browser or database. */
  backend?: ProjectStorageBackend | null;
  legacyStorage?: LegacyStorage | null;
  onError?: (error: ProjectStorageError) => void;
};

export function createProjectStorage(
  options: ProjectStorageOptions = {},
): StateStorage<Promise<void>> {
  const browser = typeof window === "undefined" ? undefined : window;
  if (!browser && options.backend === undefined && options.legacyStorage === undefined) {
    return { getItem: () => null, setItem: async () => {}, removeItem: async () => {} };
  }

  const report = (operation: ProjectStorageError["operation"], key: string, cause: unknown) => {
    const detail: ProjectStorageError = {
      operation,
      key,
      message:
        operation === "read"
          ? "Saved pictures could not be opened. Existing saved data has been preserved."
          : "Your latest picture changes could not be saved. Keep this window open and free storage space before continuing.",
      cause,
    };
    // Error reporting must never turn a handled persistence failure into an unhandled rejection.
    try {
      options.onError?.(detail);
    } catch {
      /* The storage result is independent of notification handlers. */
    }
    try {
      browser?.dispatchEvent(new CustomEvent(PROJECT_STORAGE_ERROR_EVENT, { detail }));
    } catch {
      /* SSR/test or unavailable events. */
    }
  };

  let legacy = options.legacyStorage;
  if (legacy === undefined) {
    try {
      legacy = browser?.localStorage ?? null;
    } catch {
      legacy = null;
    }
  }
  let backend = options.backend;
  if (backend === undefined) {
    try {
      backend = browser?.indexedDB ? indexedDbBackend(browser.indexedDB) : null;
    } catch {
      backend = null;
    }
  }
  if (
    browser &&
    options.backend === undefined &&
    backend &&
    ["localhost", "127.0.0.1", "[::1]"].includes(browser.location.hostname)
  ) {
    // Keep the existing IndexedDB/legacy migration path, then merge it with the folders.
    const durable = backend;
    backend = withProjectFolders({
      getItem: async (key) => (await durable.getItem(key)) ?? legacy?.getItem(key) ?? null,
      setItem: (key, value) => durable.setItem(key, value),
      removeItem: (key) => durable.removeItem(key),
    });
  }

  // Serialize reads, migrations, writes, and removals. In particular, an old migration
  // cannot finish after a newer write, and reads always observe preceding writes.
  let pending: Promise<void> = Promise.resolve();
  const ordered = <T>(action: () => Promise<T>): Promise<T> => {
    const result = pending.then(action);
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const unreadableKeys = new Set<string>();

  const removeLegacyAfterCommit = (key: string) => {
    // Never remove the legacy copy before the IndexedDB transaction commits.
    try {
      legacy?.removeItem(key);
    } catch {
      /* Durable save succeeded; retain the harmless legacy backup if cleanup is denied. */
    }
  };

  return {
    getItem: (key) =>
      ordered(async () => {
        try {
          if (backend) {
            const saved = await backend.getItem(key);
            if (saved !== null) {
              unreadableKeys.delete(key);
              return saved;
            }
            const old = legacy?.getItem(key) ?? null;
            if (old !== null) {
              try {
                await backend.setItem(key, old);
                removeLegacyAfterCommit(key);
              } catch (error) {
                // The only existing copy is still in localStorage; it remains usable.
                report("write", key, error);
              }
            }
            unreadableKeys.delete(key);
            return old;
          }
          if (!legacy) throw new Error("Browser storage is unavailable.");
          const saved = legacy.getItem(key);
          unreadableKeys.delete(key);
          return saved;
        } catch (error) {
          // Never replace unknown persisted projects with a default empty state after
          // a failed hydration. A successful retry of getItem unlocks future writes.
          unreadableKeys.add(key);
          report("read", key, error);
          throw error;
        }
      }),
    setItem: (key, value) => {
      queuedSaves++;
      publishSaveStatus("saving");
      return ordered(async () => {
        try {
          if (unreadableKeys.has(key))
            throw new Error("Saving is paused until existing pictures can be read.");
          if (backend) {
            await backend.setItem(key, value);
            removeLegacyAfterCommit(key);
          } else if (legacy) {
            // localStorage.setItem is atomic and checks the browser's actual quota.
            // This fallback is used only when IndexedDB is unavailable.
            legacy.setItem(key, value);
          } else {
            throw new Error("Browser storage is unavailable.");
          }
          saveFailed = false;
        } catch (error) {
          saveFailed = true;
          report("write", key, error);
        } finally {
          queuedSaves--;
          publishSaveStatus(queuedSaves ? "saving" : saveFailed ? "error" : "saved");
        }
      });
    },
    removeItem: (key) =>
      ordered(async () => {
        try {
          if (unreadableKeys.has(key))
            throw new Error(
              "Removing saved pictures is paused until existing pictures can be read.",
            );
          // Remove the old copy first so a failed cleanup cannot resurrect it after
          // a successful IndexedDB deletion. A failed backend delete retains its data.
          if (legacy) legacy.removeItem(key);
          if (backend) await backend.removeItem(key);
          else if (!legacy) throw new Error("Browser storage is unavailable.");
        } catch (error) {
          report("remove", key, error);
        }
      }),
  };
}

function indexedDbBackend(factory: IDBFactory): ProjectStorageBackend {
  let connection: Promise<IDBDatabase> | undefined;
  const open = (): Promise<IDBDatabase> => {
    if (connection) return connection;
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DATABASE_NAME, 1);
      let abandoned = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(OBJECT_STORE))
          request.result.createObjectStore(OBJECT_STORE);
      };
      request.onsuccess = () => {
        const database = request.result;
        if (abandoned) {
          database.close();
          return;
        }
        database.onversionchange = () => {
          database.close();
          connection = undefined;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error ?? new Error("Could not open picture storage."));
      request.onblocked = () => {
        abandoned = true;
        reject(new Error("Picture storage upgrade is blocked by another open window."));
      };
    }).catch((error: unknown) => {
      connection = undefined;
      throw error;
    });
    return connection;
  };

  const transaction = async <T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const database = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = database.transaction(OBJECT_STORE, mode);
      const request = operation(tx.objectStore(OBJECT_STORE));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      // A successful request is insufficient: a subsequent quota/IO failure may
      // still abort the transaction. Resolve only on durable transaction completion.
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(tx.error ?? request.error ?? new Error("Picture storage transaction was aborted."));
      tx.onerror = () =>
        reject(tx.error ?? request.error ?? new Error("Picture storage transaction failed."));
    });
  };

  return {
    getItem: async (key) => {
      const value: unknown = await transaction("readonly", (store) => store.get(key));
      if (value === undefined) return null;
      if (typeof value !== "string")
        throw new Error("Saved picture storage has an unexpected format.");
      return value;
    },
    setItem: async (key, value) => {
      await transaction("readwrite", (store) => store.put(value, key));
    },
    removeItem: async (key) => {
      await transaction("readwrite", (store) => store.delete(key));
    },
  };
}
