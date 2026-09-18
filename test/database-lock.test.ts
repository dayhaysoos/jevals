import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { lockDatabase } from "../src/database-lock.js";
test("database ownership blocks duplicate servers and releases only its own lock", () => {
  const dir = mkdtempSync(join(tmpdir(), "jevals-lock-")),
    db = join(dir, "db.sqlite");
  try {
    const release = lockDatabase(db);
    assert.throws(() => lockDatabase(db), /already using/);
    release();
    assert.equal(existsSync(db + ".lock"), false);
    const second = lockDatabase(db),
      owner = readFileSync(db + ".lock", "utf8");
    release();
    assert.equal(readFileSync(db + ".lock", "utf8"), owner);
    second();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("only a confirmed dead owner can be reclaimed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jevals-stale-lock-")),
    db = join(dir, "db.sqlite");
  try {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
    const pid = child.pid;
    await once(child, "exit");
    writeFileSync(db + ".lock", JSON.stringify({ pid, token: "dead-owner" }));
    const release = lockDatabase(db);
    assert.equal(
      JSON.parse(readFileSync(db + ".lock", "utf8")).pid,
      process.pid,
    );
    release();
    writeFileSync(db + ".lock", "not verifiable");
    assert.throws(() => lockDatabase(db), /could not be verified/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stale recovery is serialized even when another claim interleaves with metadata reads", async () => {
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const dir = mkdtempSync(join(tmpdir(), "jevals-reclaim-race-")),
    db = join(dir, "db.sqlite");
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  const pid = child.pid;
  await once(child, "exit");
  writeFileSync(db + ".lock", JSON.stringify({ pid, token: "dead" }));
  const original = fs.readFileSync;
  let reads = 0,
    blocked = false,
    release: (() => void) | undefined;
  try {
    fs.readFileSync = ((...args: Parameters<typeof original>) => {
      const result = original(...args);
      if (
        args[0] === join(fs.realpathSync(dir), "db.sqlite.lock") &&
        ++reads === 2
      ) {
        assert.throws(() => lockDatabase(db), /already using/);
        blocked = true;
      }
      return result;
    }) as typeof original;
    syncBuiltinESMExports();
    release = lockDatabase(db);
    assert.equal(blocked, true);
  } finally {
    fs.readFileSync = original;
    syncBuiltinESMExports();
    release?.();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failed owner metadata writes remove the incomplete claim and allow retry", async () => {
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const dir = mkdtempSync(join(tmpdir(), "jevals-lock-write-")),
    db = join(dir, "db.sqlite");
  const original = fs.writeFileSync;
  try {
    fs.writeFileSync = (() => {
      throw Object.assign(Error("disk full"), { code: "ENOSPC" });
    }) as typeof original;
    syncBuiltinESMExports();
    assert.throws(() => lockDatabase(db), /disk full/);
    assert.equal(existsSync(db + ".lock"), false);
    fs.writeFileSync = original;
    syncBuiltinESMExports();
    const release = lockDatabase(db);
    release();
  } finally {
    fs.writeFileSync = original;
    syncBuiltinESMExports();
    rmSync(dir, { recursive: true, force: true });
  }
});
