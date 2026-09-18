# Full-codebase review loop — September 18, 2026

Scope: the full workbench at `80c12b2`, followed by its fixes, rather than only the release diff. Independent reviews covered runtime/storage/CLI and domain/UI/WebMCP. Project contracts came from README, PRODUCT, CONTEXT, and the user's accepted requirements. The supervisor reproduced security and ownership issues and ran acceptance checks with isolated databases and simulated providers.

## Findings and fixes

| Priority | Finding | Fix |
| --- | --- | --- |
| P1 | Dangling database symlinks permit duplicate ownership | Resolve symlink targets before database creation and locking |
| P1 | Stale-owner metadata checking and deletion can race with a replacement owner | Hold a kernel-managed SQLite exclusive transaction throughout ownership, including recovery |
| P1 | Untrusted hostnames can reach the loopback workbench through DNS rebinding | Reject untrusted Host, Origin, and cross-site request headers before reading or writing |
| P2 | Failed metadata writes leave an incomplete claim that blocks retries | Remove the exclusively created claim on write failure and release ownership |
| P2 | Focused schema controls use stale indexes after external schema updates | Address mounted fields by stable keys, including rename and removal handling |
| P2 | Running detail with a completed global summary stops polling too soon | Continue polling while selected detail or loaded history is running |
| P2 | Fractional expected Score values cannot be displayed or authored | Use a bounded numeric editor with fractional values and rubric descriptions |
| P2 | Focused question controls can mutate externally changed primitive/rubric/options | Reject stale mounted controls before their edit handlers run |

## Iterations

1. Initial review: seven actionable findings; fixed with regression checks.
2. Follow-up: one additional stale-question-control finding; fixed.
3. Execution checks caught baseline timing and warning dismissal regressions in the new guard; corrected before accepting the fixes.
4. Final independent runtime and UI/domain reviews: **zero actionable findings**. No documented-standard violations or mandatory style-only changes remained.

## Verification

- TypeScript check and all 69 unit/integration tests passed.
- Ownership tests exercise stale-recovery interleaving, failed writes, file/directory aliases, dangling symlinks, and safe initialization/recovery cleanup.
- HTTP tests reject hostile hosts and cross-site origins for reads and writes.
- Browser/native WebMCP checks passed, including schema reordering while focused, fractional expectation editing, a running-detail/completed-summary mismatch, stale Score/Choice/Noul controls, and normal Choice rename/Tab progression.
- Packed-install checks passed with production dependencies only, including duplicate ownership and recovery after forced termination.

No paid requests or live database edits were used for this review. Zero findings describes the final review result, not a guarantee that the codebase contains no undiscovered bugs.
