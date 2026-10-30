# Agent guide

ERC-8004 agent chat: Hono/LangChain backend in `src/`, Vue 3 + Vite frontend in `frontend/`.

## Before you say "done"

```bash
npm run check   # typecheck, oxlint, oxfmt, steiger (FSD), fallow dead-code + dupes, vitest coverage gate
```

Frontend changes also need `npm run frontend:build` and `npm run test:e2e:offline` (run vite on
`--host 127.0.0.1` first if the Playwright web server times out).

## Frontend layout (Feature-Sliced Design, `frontend/src`)

| Layer     | Holds                                                               |
| --------- | ------------------------------------------------------------------- |
| `app/`    | Entry (`main.ts`), providers (`App.vue`, `auth/`), global CSS       |
| `pages/`  | Route-level screens (`home`): `ui/` sections, `model/` composables  |
| `shared/` | `api/` (backend client), `config/` (networks), `lib/`, `ui/` kit    |

- Imports go **downward only** (`app → pages → shared`). Never import upward or sideways.
- Cross-layer imports use the `@/` alias and the segment's `index.ts`
  (`@/shared/api`, not `@/shared/api/api`). Check with `npm run fsd`.
- Add a `widgets/`, `features/` or `entities/` layer only when a slice is used from 2+ places
  (Steiger's `insignificant-slice` rule enforces this).
- Keep `.vue` files under ~800 lines: pull logic into `model/use-*.ts` composables
  (see `use-oasf-taxonomy.ts`, `use-agent-image.ts`). `CreateAgent.vue` is still oversized.

## Rules

- Write the test first for logic changes; colocate frontend tests (`*.test.ts`), backend tests live
  in `src/**/tests/`. Coverage thresholds are in `config/vitest.config.ts` and only go up.
- Formatting is `oxfmt` (`npm run format`). `.vue` files are excluded — oxfmt mangles
  multi-statement `@click` handlers.
- Don't silence `fallow`/`oxlint` with ignores; delete dead code instead.
- Never commit secrets or `agents/*/wallet.json`. gitleaks runs on every PR.
- Don't hand-edit `package-lock.json`; run `npm install`.

## Tooling map

| Tool          | Command / config                                                   |
| ------------- | ------------------------------------------------------------------ |
| oxlint        | `npm run lint` · `config/oxlintrc.json`                                  |
| oxfmt         | `npm run format[:check]` · `.oxfmtrc.json`                         |
| Steiger (FSD) | `npm run fsd` · `config/steiger.config.ts`                                |
| fallow        | `npm run dead-code`, `npm run duplicates` · `config/.fallowrc.json`       |
| Vitest        | `npm run test:unit`, `npm run test:coverage`                       |
| Stryker       | `npm run test:mutate` (weekly CI) · `config/stryker.config.json`          |
| Lighthouse    | `lhci autorun` in the Danger workflow · `config/lighthouserc.json`        |
| CodeQL        | `.github/workflows/codeql.yml`                                     |
| gitleaks      | `.github/workflows/gitleaks.yml` · `.gitleaks.toml`                |
| Danger        | `dangerfile.ts` — one PR comment: rules, coverage, Lighthouse, module diagram (`npm run diagram`) |
