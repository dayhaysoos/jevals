# Primitive examples

Consult the live framework and tool schemas for exact input fields. These are authoring examples, not a substitute for discovered schemas.

| Primitive | Authored question | Expected answer |
| --- | --- | --- |
| Noul | Does this food meet the supplied sandwich definition? | Boolean, with a rationale. The threshold converts the returned yes probability to yes/no. |
| Choice | Classify its bread format as `sliced`, `split_roll`, or `neither`. | Exact option label, with a rationale. Descriptions explain each option. |
| Score | How actionable is this bug report, from vague complaint to steps plus environment? | Numeric value on the zero-based ordered rubric, with a rationale and optional tolerance. |

## Mixed sandwich classification

Use shared `food` and `definition` fields, preferably with a generated state form. State explicitly: fillings between two bread slices or inside a split bread roll qualify; wraps, tortillas and bowls do not.

- `is_sandwich` (Noul) tests membership under that definition.
- `bread_format` (Choice) selects the food's physical format independently of sandwich membership.

A hot dog in a split roll expects `true` and `split_roll`; grilled cheese between bread slices expects `true` and `sliced`; a tortilla taco expects `false` and `neither`. A split roll without a filling is a useful counterexample: `false` and `split_roll`. Each case has two separately justified expectations. Ask for review when the food description omits details needed by either question.

## Score rubric

Define ordered levels before assigning numeric expectations. For report quality, a three-level rubric could be:

- 0: No identifiable feature or reproduction details.
- 1: Identifies the feature and steps, but omits the environment.
- 2: Identifies the feature, steps and environment.

Score responses may be fractional; do not round them before assessing error. Tolerance is measured in level units, defaulting to 0.5; zero requires an exact score. Use tighter tolerances only when justified by the intended test. Adding/removing/reordering levels invalidates numeric keys, even if their old numbers remain in range.

For bundled demonstrations, the project README describes `npm run seed`. It imports curated definitions and answer keys, makes no requests, and is repeatable. Seeding the user's workspace is a content change: use it only when examples were requested, and inspect the resulting Jevals rather than assuming example IDs.
