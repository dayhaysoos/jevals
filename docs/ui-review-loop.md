# 0.1.1 branch review loop

Scope: ui/workbench-refinement against main at 06ff1f7. The initial candidate was 0069edf; the reviewed code after fixes is 048c5bd. Requirements came from the requested UI pass, DESIGN.md and release-0.1.1.md. Standards and spec reviews ran independently; the supervisor reproduced and resolved findings. The scope was this branch, not an audit of unchanged code.

## Standards

Pass 1 found one actionable P2 regression: Add question called whole-suite validation, so temporarily blank Jeval name/model or an existing case name blocked a valid new question. Existing question-authoring transactions intentionally tolerate unrelated incomplete draft fields. An independent probe showed whole-suite validation rejected a blank existing case name while upsertQuestion accepted it.

Fix: validate on an isolated clone through the existing question transaction, then commit only the new question. Browser regressions clear unrelated metadata and an existing case name, add a valid question, and verify the existing blanks remain unchanged.

Pass 2 at 048c5bd: zero actionable findings, including a fresh examination of the complete branch and the fix.

## Spec

Both independent passes returned zero actionable findings against the requested button hierarchy, focused creation forms, SDK mappings, prefilled defaults, accessible dismissal, and WebMCP integration.

## Supervisor finding

The same whole-suite validation coupling affected Add case. Fix: validate the new case’s schema and keyed expectations independently of incomplete metadata or other case names, while preserving the 100-case limit. Browser regressions verify a valid case can be added without rewriting those incomplete drafts. Invalid state and expectations still use the existing validators; this does not weaken save/run validation.

## Validation and outcome

Typecheck passed, all 69 unit/integration tests passed, and desktop/mobile native WebMCP browser acceptance passed with 20 registered tools. Packed-install acceptance passed for the updated package. Tests used isolated databases and simulated providers; no real workspace database or paid request was used by this review.

Two actionable issues were fixed (one standards finding and one supervisor finding). Final independent standards/spec review: zero actionable findings on each axis. Registry publication and release tagging remain pending.
