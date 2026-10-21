# TODO — Kudosity n8n community node

Status as of **21 Oct 2026**. Last commit 26 Mar 2026; one commit, 7 months idle. Local
and `origin/main` are in sync, so nothing is outstanding elsewhere.

Not tracked in Jira. There is no general integrations project — the convention is one per
integration (SAL Salesforce, EQ Eloqua, SI Shopify) and none exists for n8n. This file is
the task list until that decision is made.

## What exists

| Piece | State |
|---|---|
| `credentials/KudosityApi.credentials.ts` | API-key credential, header auth |
| `nodes/Kudosity/Kudosity.node.ts` | Four send operations — SMS, MMS, WhatsApp (text + template), RCS |
| `nodes/Kudosity/KudosityTrigger.node.ts` | Webhook trigger, one registration per selected event type |
| `README.md`, `PUBLISHING.md` | User-facing docs and a publishing guide |
| TypeScript source | **Compiles clean** (verified with `--skipLibCheck`) |

Endpoints used: `POST /sms`, `/mms`, `/whatsapp/messages`, `/rcs/messages` against
`https://api.transmitmessage.com/v2`.

## Blockers — nothing ships until these are done

### 1. The build fails

`npm run build` does not complete. Three separate causes:

- **`tsconfig.json` has no `skipLibCheck`.** The n8n dependency types reference modules
  that are not installed (`axios`, `express`, `luxon`, `@sentry/node`, `@langchain/core`),
  so type-checking dies inside `node_modules` before reaching our code. Adding
  `"skipLibCheck": true` compiles clean — verified. This is standard for n8n community
  nodes and is the one-line fix.
- **`gulp` is not installed.** `scripts.build` is `tsc && gulp build:icons`, but gulp is
  absent from `devDependencies` and there is no gulpfile. Either add both, or drop the
  icon step and copy `kudosity.svg` into `dist/` another way.
- **`scripts.lint` and `prepublishOnly` reference tooling that does not exist** — no
  eslint, no `eslint-plugin-n8n-nodes-base`, and no `.eslintrc.prepublish.js`.
  `prepublishOnly` will therefore fail at publish time even if the build is fixed.

There is no `dist/`, confirming this has never been built.

### 2. The package name is taken

`n8n-nodes-kudosity` is **already published on npm at 0.1.6**, from
`github.com/burstsms/n8n-nodes-kudosity`, last modified Feb 2025. This repo is at 0.1.0 and
points at a third URL. Publishing as-is is impossible — npm rejects a version below the
one already there.

**Decision taken: publish under a new name.** Two candidates, both valid for n8n, which
requires either an `n8n-nodes-*` name or a scoped `@scope/n8n-nodes-*`:

- `@kudosity/n8n-nodes-kudosity` — needs the `kudosity` npm org to exist and to grant access
- `n8n-nodes-kudosity-messaging` — unscoped, no org needed, uglier

### 3. `main` points at a file that is not published

`main` is `index.js` but `files` is `["dist"]`. `index.ts` sits at the repo root and
compiles to `dist/index.js`, so the published tarball will not contain `index.js` at the
path `main` names. Set `main` to `dist/index.js`.

### 4. `repository.url` is wrong

Says `github.com/kudosity/n8n-nodes-kudosity`. The actual remote is
`github.com/codechito/kudosity-n8n`. Three different URLs are in play across package.json,
git, and the published npm package — worth settling before publishing.

## Then

- **Verify against the live API.** Nothing here has been run against a real account. Each
  of the four send operations, plus an inbound event through the trigger.
- **Confirm the trigger's per-event-type registration.** The node registers a separate
  webhook per selected event type. Check Kudosity honours that rather than sending all
  types to one URL — the same open question the Make app has.
- **Error handling.** Confirm the shape of a real error body and surface it as a proper
  `NodeApiError` rather than a raw throw.
- **Add `continueOnFail` support** so a failed send does not halt the whole workflow.
- Decide whether to pursue n8n **verified community node** status, which has stricter
  linting and review requirements than a plain npm publish.

## Open questions

- Does anyone still own or maintain the `burstsms` package? If it is dead, taking over the
  name may be cleaner than publishing a second one and leaving users to guess.
- Should this repo move to a company org rather than `codechito`?
