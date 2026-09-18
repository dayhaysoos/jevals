# Jevals 0.1.1

Focused question/case creation dialogs replace inline additions. Case forms put blank fields first and prefilled schema defaults below expected answers. Main editing actions use black buttons; removals use red outlined buttons. Small SDK request field labels connect form inputs to instructions, criteria, model, and state.

Native dialogs support Escape, explicit cancellation, backdrop dismissal, keyboard focus wrapping, and focus restoration. Inside-to-outside drag gestures do not dismiss forms. Modal drafts do not change the Jeval until submitted, and changes to the underlying definition prevent stale submissions. WebMCP includes authoring dialog open/cancel tools alongside the existing saved-record tools.

There are no database migrations or evaluation-contract changes. API credentials and local databases are excluded from the package. Reviewed starter examples remain unchanged; the Email intent demo is workspace data, not a new seed fixture.

## Local validation

- Typecheck passed; all 69 unit/integration tests passed.
- Desktop/mobile native WebMCP browser acceptance passed with 20 registered tools, including modal cancellation, keyboard wrapping, backdrop dismissal, unchanged schema defaults, and stale-form rejection.
- Packed-install acceptance passed with 32 allowlisted files and no development dependencies, credentials, or workspace databases.
- npm publication dry run passed for jevals@0.1.1. Real registry publication and tagging remain pending.

The branch [review loop](ui-review-loop.md) fixed two validation-coupling issues. The second independent standards/spec reviews returned zero actionable findings.

## Publish after review and merge

From the merged main checkout:

```sh
git switch main
git pull --ff-only
npm ci
npm run typecheck
npm test
npm run test:browser
npm run test:package
npm publish --dry-run
npm publish --access public --tag latest
git tag -a v0.1.1 -m "Jevals 0.1.1"
git push origin v0.1.1
```

Wait for npm processing to complete, then check availability:

```sh
npm view jevals@0.1.1 version --prefer-online
```

Try the published CLI from a directory outside the source checkout, stopping any existing server for that workspace first:

```sh
cd ~/jevals-demo
npx --yes --prefer-online jevals@0.1.1 --port 4318
```

This document prepares the release; it does not indicate registry publication.
