import { databaseIdentity, lockDatabase } from "./database-lock.js";
import { Store } from "./store.js";

/** Own initialization and recovery for the entire lifetime of a connection. */
export function openDatabase(path: string, purpose: "server" | "seed") {
  const database = databaseIdentity(path);
  const release = lockDatabase(database);
  let store: Store | undefined;
  try {
    store = new Store(database, {
      starter: purpose === "server",
    });
    if (purpose === "server") store.recoverInterruptedRuns();
  } catch (error) {
    try {
      store?.db.close();
    } finally {
      release();
    }
    throw error;
  }
  let closed = false;
  return {
    store,
    close() {
      if (closed) return;
      closed = true;
      try {
        store!.db.close();
      } finally {
        release();
      }
    },
  };
}
