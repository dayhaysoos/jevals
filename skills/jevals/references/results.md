# Results and comparisons

## Diagnose a partial failure

Inspect the exact saved run and its outcome, then locate each failed request or unusable question answer. Open the associated request/response trace and record the actual error. One malformed answer may coexist with valid sibling answers in the same request; retain and inspect those siblings.

- **Complete:** all answers usable, including valid answers that are wrong.
- **Partial:** usable answers coexist with request/answer failures.
- **Failed:** no usable answers.
- **Running:** unfinished; no final quality conclusion.

Partial and failed runs cannot qualify as best. Do not treat missing accuracy or unavailable costs as zero, and do not rerun without existing authorization. Explain which questions/cases are affected and whether the available evidence points to provider/request failure, unusable response shape, or incorrect judgment. If the trace cannot establish a cause, leave it unresolved.

## Compare prompt experiments

Use the workbench's dataset compatibility, not just matching names. Comparable snapshots retain the question IDs/types, relevant Choice labels or ordered Score rubric, case states and reviewed expected values/tolerances. Changing the answer key changes the experiment. Old run snapshots remain immutable.

- Noul/Choice: higher accuracy, then lower Brier error.
- Score: lower mean absolute error, then higher within-tolerance pass rate.
- Equal metrics: newer creation timestamp, then stable run ID descending.

Score confidence is separate from error/tolerance; Noul probability is the probability of yes, not generic confidence. Shared request tokens, latency and estimated cost cover the entire multi-question request once, not once per answer. Unknown costs remain unavailable.

For a held-out run, inspect results after choosing the prompt and report them separately. If those cases then influence tuning, they are development evidence; reserve new held-out examples before making another held-out claim. Small illustrative datasets support observations on those cases, not universal accuracy claims.
