import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { resolve, dirname, basename } from "node:path";

/** Resolve file aliases before choosing the ownership lock. */
export function databaseIdentity(
  database: string,
  aliases = new Set<string>(),
): string {
  const path = resolve(database);
  if (aliases.has(path) || aliases.size >= 40)
    throw Error("Database path contains a symbolic-link cycle.");
  aliases.add(path);
  fs.mkdirSync(dirname(path), { recursive: true });
  try {
    const entry = fs.lstatSync(path);
    if (entry.isSymbolicLink())
      return databaseIdentity(
        resolve(dirname(path), fs.readlinkSync(path)),
        aliases,
      );
    return fs.realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return resolve(fs.realpathSync(dirname(path)), basename(path));
  }
}

/** One server owns recovery and writes for a database; seed connections do not run recovery. */
export function lockDatabase(database: string): () => void {
  const path = databaseIdentity(database) + ".lock";
  // The kernel-held SQLite transaction serializes every claim and stale recovery.
  // It is automatically released on process death; metadata is only diagnostic.
  const guard = new DatabaseSync(
    databaseIdentity(database) + ".ownership.sqlite",
  );
  try {
    guard.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
  } catch (error) {
    guard.close();
    if ((error as { errcode?: number }).errcode === 5)
      throw Error(
        "Another Jevals process is already using this database. Stop it, or choose another workspace with --dir.",
      );
    throw error;
  }
  const token = randomUUID();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = fs.openSync(path, "wx", 0o600);
        try {
          fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
          fs.closeSync(fd);
        } catch (error) {
          try {
            fs.closeSync(fd);
          } catch {}
          // We exclusively created this claim while holding the ownership guard.
          try {
            fs.unlinkSync(path);
          } catch {}
          throw error;
        }
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          process.removeListener("exit", release);
          try {
            if (JSON.parse(fs.readFileSync(path, "utf8")).token === token)
              fs.unlinkSync(path);
          } catch {
          } finally {
            guard.close();
          }
        };
        process.once("exit", release);
        return release;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        let owner: { pid: number; token: string };
        try {
          owner = JSON.parse(fs.readFileSync(path, "utf8"));
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
            if (JSON.parse(fs.readFileSync(path, "utf8")).token === owner.token)
              fs.unlinkSync(path);
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
  } catch (error) {
    guard.close();
    throw error;
  }
}
