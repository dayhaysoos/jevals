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
