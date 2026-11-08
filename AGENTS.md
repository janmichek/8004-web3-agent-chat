# Agent guide

ERC-8004 agent chat: Hono/LangChain backend in `src/`, Vue 3 + Vite frontend in `apps/frontend/`.

## Before you say "done"

```bash
npm run check   # typecheck, oxlint, oxfmt, steiger (FSD), fallow dead-code + dupes + health, vitest coverage gate
```

`npm run check` is the pre-PR gate. While iterating, typecheck/lint the touched files and run only
the unit tests that cover the change (`npx vitest run <path>`), then run the full gate once before
handing off.

For frontend changes:

```bash
npm run frontend:build        # template + type errors
npm run test:e2e:related      # specs mapped from the current git diff (fast)
```

`test:e2e:related` falls back to the full offline suite when you touch a global file (`app/`,
`shared/`, `HomePage.vue`, `index.html`, `e2e/helpers.ts`) or a file it has no mapping for. Use
`E2E_BASE=origin/main` to cover a whole branch and `-- --list` to see the selection. Run the full
`npm run test:e2e:offline` before opening a PR. If the Playwright web server times out, start Vite
on `--host 127.0.0.1` first.

## Frontend layout (Feature-Sliced Design, `apps/frontend/src`)

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
  (see `use-oasf-taxonomy.ts`, `use-agent-memory.ts`) and move large style blocks into a
  sibling `.css` file loaded with `<style scoped src="./x.css">` (see `CreateAgent.vue`).

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
| fallow        | `npm run dead-code`, `npm run duplicates`, `npm run health` · `config/.fallowrc.json` |
| Vitest        | `npm run test:unit`, `npm run test:coverage`                       |
| Playwright    | `npm run test:e2e:related`, `npm run test:e2e:offline` · `config/playwright.config.ts` |
| Stryker       | `npm run test:mutate` (weekly CI) · `config/stryker.config.json`          |
| Lighthouse    | `lhci autorun` in the Danger workflow · `config/lighthouserc.json`        |
| CodeQL        | `.github/workflows/codeql.yml`                                     |
| gitleaks      | `.github/workflows/gitleaks.yml` · `.gitleaks.toml`                |
| Danger        | `dangerfile.ts` — one PR comment: rules, coverage, Lighthouse, module diagram (`npm run diagram`) |
