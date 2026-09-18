import {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  realpathSync,
  mkdirSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve, dirname, basename } from "node:path";

/** Resolve file aliases before choosing the ownership lock. */
export function databaseIdentity(database: string): string {
  const path = resolve(database);
  mkdirSync(dirname(path), { recursive: true });
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return resolve(realpathSync(dirname(path)), basename(path));
  }
}

/** One server owns recovery and writes for a database; seed connections do not run recovery. */
export function lockDatabase(database: string): () => void {
  const path = databaseIdentity(database) + ".lock";
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
      } finally {
        closeSync(fd);
      }
      const release = () => {
        process.removeListener("exit", release);
        try {
          if (JSON.parse(readFileSync(path, "utf8")).token === token)
            unlinkSync(path);
        } catch {}
      };
      process.once("exit", release);
      return release;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner: { pid: number; token: string };
      try {
        owner = JSON.parse(readFileSync(path, "utf8"));
        if (!Number.isInteger(owner.pid) || owner.pid < 1) throw Error();
      } catch {
        throw Error(
          `Database lock could not be verified: ${path}. Stop other Jevals servers and inspect that lock before restarting.`,
        );
      }
      try {
        process.kill(owner.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          // Reclaim only the same confirmed-dead owner, never another process's new lock.
          if (JSON.parse(readFileSync(path, "utf8")).token === owner.token)
            unlinkSync(path);
          continue;
        }
      }
      throw Error(
        `A Jevals server is already using this database (PID ${owner.pid}). Stop it, or choose another workspace with --dir.`,
      );
    }
  }
  throw Error(
    "Could not claim the database. Try again after the other server exits.",
  );
}
