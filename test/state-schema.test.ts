import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialState,
  stateObject,
  stateErrors,
  validateSchema,
} from "../src/state-schema.js";
import { seed } from "../src/seed.js";
test("new cases receive defaults without overwriting existing states", () => {
  const fields = structuredClone(seed.stateSchema!);
  const existing = seed.cases[0].state;
  fields[1].defaultValue = "New definition";
  const fresh = stateObject(initialState(fields))!;
  assert.equal(fresh.definition, "New definition");
  assert.equal(fresh.food, "");
  assert.equal(seed.cases[0].state, existing);
  assert.ok(
    stateErrors({
      ...seed,
      stateSchema: fields,
      cases: [{ ...seed.cases[0], state: JSON.stringify(fresh) }],
    }).some((e) => e.includes("Food description is required")),
  );
});
test("schema changes flag missing values while preserving removed and extra keys", () => {
  const fields = structuredClone(seed.stateSchema!);
  fields[0].key = "description";
  const state = stateObject(seed.cases[0].state)!;
  assert.ok(
    stateErrors({ ...seed, stateSchema: fields }).some((e) =>
      e.includes("Food description is required"),
    ),
  );
  state.description = "Changed food";
  assert.equal(state.food, "A sausage served inside a split bread roll.");
  assert.equal(
    stateErrors({
      ...seed,
      stateSchema: fields,
      cases: [{ ...seed.cases[0], state: JSON.stringify(state) }],
    }).length,
    0,
  );
  assert.equal(
    stateErrors({ ...seed, stateSchema: fields.slice(1) }).length,
    0,
  );
});
test("unsafe/duplicate keys and non-text values are rejected; no-schema plain text works", () => {
  assert.throws(() =>
    validateSchema([{ ...seed.stateSchema![0], key: "__proto__" }]),
  );
  assert.throws(() =>
    validateSchema([seed.stateSchema![0], seed.stateSchema![0]]),
  );
  assert.equal(stateObject("plain text"), null);
  assert.ok(
    stateErrors({
      ...seed,
      cases: [{ ...seed.cases[0], state: '{"food":42,"definition":"x"}' }],
    }).some((e) => e.includes("must be text")),
  );
  assert.deepEqual(
    stateErrors({
      ...seed,
      stateSchema: [],
      cases: [{ ...seed.cases[0], state: "plain text" }],
    }),
    [],
  );
});
