import type { StateField, Suite } from "./types.js";
export function stateObject(state: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(state);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
export function initialState(fields: StateField[]): string {
  return fields.length
    ? JSON.stringify(
        Object.fromEntries(fields.map((f) => [f.key, f.defaultValue])),
        null,
        2,
      )
    : "";
}
export function validateSchema(
  fields: unknown,
): asserts fields is StateField[] {
  if (!Array.isArray(fields) || fields.length > 30)
    throw Error("State schema must have at most 30 fields.");
  const keys = new Set<string>();
  for (const field of fields) {
    if (
      !field ||
      typeof field.key !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.key) ||
      ["__proto__", "constructor", "prototype"].includes(field.key) ||
      keys.has(field.key) ||
      typeof field.label !== "string" ||
      !field.label.trim() ||
      !["text", "long-text"].includes(field.type) ||
      typeof field.required !== "boolean" ||
      typeof field.defaultValue !== "string"
    )
      throw Error(
        "State fields need unique identifier keys, labels, text types, and string defaults.",
      );
    keys.add(field.key);
  }
}
export function stateErrors(suite: Suite): string[] {
  const fields = suite.stateSchema ?? [];
  if (!fields.length) return [];
  return suite.cases.flatMap((c) => {
    const state = stateObject(c.state);
    if (!state)
      return [`${c.name}: state must be a JSON object for this schema.`];
    return fields.flatMap((f) => {
      const value = state[f.key];
      if (value !== undefined && typeof value !== "string")
        return [`${c.name}: ${f.label} must be text.`];
      if (f.required && (typeof value !== "string" || !value.trim()))
        return [`${c.name}: ${f.label} is required.`];
      return [];
    });
  });
}
