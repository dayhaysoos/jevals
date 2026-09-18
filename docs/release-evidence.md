# 0.1.0 release candidate

## What changed

The npm package now ships an executable CLI, compiled server, built browser UI/fonts, curated examples, MIT license and the Jevals agent skill. User data belongs to a workspace, not the installed package. First-run diagnostics cover missing credentials, bad arguments, occupied ports and provider failures. A database ownership lock prevents duplicate servers from running recovery against the same database; dead owners can be reclaimed, unverified owners cannot. File symlinks resolve to the same database identity, and seed operations acquire the same exclusive ownership without recovering Runs.

## Local evidence

- TypeScript check, 65 unit/integration checks and native WebMCP/browser acceptance use isolated databases and simulated providers.
- Shared startup owns readiness, rollback and shutdown without import side effects. Tests cover occupied-port cleanup including development middleware, draining an accepted Run before closing storage, workspace configuration without global mutation, and atomic rollback of failed example adoption.
- `npm run test:package` runs `npm pack`, reviews the allowlisted artifact, installs it into a clean directory with production dependencies only, and invokes the installed executable and npm exec. It checks repeatable seeding, workspace .env discovery, built UI/fonts, missing-key and port-conflict errors, a mixed Noul/Choice/Score request, provider failure and persisted snapshots after restart, and recovery of an unfinished Run after forced termination.
- Production dependency audit reports no known vulnerabilities at preparation time.
- No credentials, private SQLite databases, backups, run traces, test fixtures or development dependencies are shipped in the artifact.
- The user's existing eight Jevals and nine runs are preserved; acceptance fixtures do not use that database.

## One live-provider smoke

On 2026-09-18T06:16:10.155Z, one synthetic hot-dog case with an explicit sandwich definition was sent through the official SDK and actual executor in an isolated temporary database. The request contained Noul membership, Choice bread format and Score description specificity. All three answers were usable, the run completed, and all three matched the independently authored expectations. Returned usage: 426 input and 66 output tokens; estimated cost 1.7892e-05 USD. The temporary database was removed; no raw trace or credential is committed.

This proves that one mixed request completed through the live integration. It does not establish general model accuracy, held-out reliability or exact billing.

## Review and release

The GitHub repository is private and the release branch is for review. npm `jevals@0.0.1` already exists; this candidate is `0.1.0` and has not been published. The registry's existing version does not launch the workbench. GitHub Actions runs unit/packed-install checks on Node 22 and 24 and native browser checks on Node 24; see actual workflow results before merging.

After approving the candidate, choose whether to make the repository public and publish version 0.1.0. The package's prepack hook builds its distributable assets. No registry publication or release tag was performed during preparation.
