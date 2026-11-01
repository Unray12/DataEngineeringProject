# Prompt: Reset the web app to the shared baseline

Paste everything below into your coding agent, run from the repository root.

---

You are a careful senior engineer. This repository contains a Next.js web app (agricultural monitoring dashboards) that was built in one pass by a single person. The team is now splitting the work across 4 members, so I want to **reset the app to a clean baseline that contains only the core infrastructure**, then let each member build their own feature areas from scratch.

Work in this order: inspect, back up, plan, reset, verify, report. Make the changes on a new branch and never rewrite or force-push history.

## 1. Safety first (before changing anything)

1. Run `git status`. If there are uncommitted changes, commit them to the current branch first (message: `chore: snapshot before baseline reset`) so nothing is lost.
2. Create an archive of the current implementation so members can still copy useful code from it:
   - `git tag archive/webapp-v1` on the current commit
   - `git branch archive/webapp-v1` at the same commit
   - Push the tag and branch to `origin` if a remote exists (plain `git push origin archive/webapp-v1`, no force).
3. Create the working branch `chore/reset-to-baseline` from the current commit.
4. Do not change Vercel settings, GitHub settings, secrets or any environment variable values. Don't delete anything outside the web app directory (data platform code, docs, Docker files and so on are untouched).

## 2. Inspect and decide

Find the web app directory (expected `web/`; Vercel's Root Directory depends on it). **If the app is not in `web/`, do not move it.** Keep it where it is and flag this in your report.

Produce an inventory table of every top-level file and folder in the app with a decision: **KEEP**, **REMOVE** or **REPLACE WITH PLACEHOLDER**, and the reason. Use the rules below. **When in doubt, keep the item and flag it in the report.** Then proceed without waiting for confirmation.

### KEEP (core infrastructure)
- Package setup: `package.json` (including `packageManager`), `bun.lock`, `tsconfig.json`, `next.config.ts` (including security headers), `next-env.d.ts` and similar generated config.
- Tooling config: ESLint, Prettier, Vitest config, Tailwind/PostCSS config, `components.json` (shadcn), `.gitignore`, `.env.example`.
- shadcn/ui primitives in `src/components/ui/` (generic components with no app logic).
- `src/lib/env.ts` (Zod-validated environment) and the optional `APP_PASSWORD` middleware, if they exist.
- Base styles (`globals.css` with generic Tailwind and shadcn tokens) and `src/lib/utils.ts` (the `cn` helper).
- CI: `.github/workflows/web-ci.yml` (or equivalent): Bun setup, `bun install --frozen-lockfile`, lint, typecheck, test, build with `DATA_MODE=mock`.
- The web `README.md` (to be edited, see section 4).
- Dependencies of the agreed stack, even if currently unused: Next.js, React, TypeScript, Tailwind, shadcn/ui deps, Recharts, TanStack Query, Zod, date-fns, date-fns-tz, Vitest, ESLint, Prettier.

### REMOVE (feature implementation, to be rebuilt by owners)
- All page content and feature UI: dashboards, charts, tables, cards, drawers, filters, navigation or sidebar components, theme toggles with app logic.
- All feature hooks, API route handlers (`src/app/api/**`), the API adapter/client, Zod domain schemas and domain types (farms, fields, devices, alerts, series and so on).
- All mock-data generators and fixtures.
- All feature tests and test fixtures (keep generic test setup only).
- App-specific utilities (formatting, narrative or insight helpers, domain calculations).
- Dependencies that are not in the agreed stack (for example a second chart library or a global state library). If unsure whether a package is used by something you keep, keep it and flag it.

### REPLACE WITH PLACEHOLDER
- `src/app/layout.tsx`: a minimal root layout (html, body, font, providers only if the Query provider setup is already generic). No sidebar or theme logic, since the app shell is a separate task.
- `src/app/page.tsx` and the route pages listed in section 3: a very small server component that shows the page name, the owner and the BR numbers, for example `Overview — owner M1 — BR1, BR7 — not implemented yet`.

## 3. Target end state

```
web/
├── package.json  bun.lock  tsconfig.json  next.config.ts  .env.example  README.md
├── (eslint / prettier / vitest / tailwind / postcss / components.json configs)
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # minimal
│   │   ├── page.tsx                   # placeholder: Overview (M1, BR1 BR7)
│   │   ├── live/page.tsx              # placeholder (M2, BR2 BR3)
│   │   ├── devices/page.tsx           # placeholder (M2, BR3)
│   │   ├── alerts/page.tsx            # placeholder (M3, BR8)
│   │   ├── quality/page.tsx           # placeholder (M3, BR4)
│   │   ├── analytics/page.tsx         # placeholder (M4, BR5 BR6)
│   │   ├── insights/page.tsx          # placeholder (M1, BR7)
│   │   └── fields/[id]/page.tsx       # placeholder (M1, BR1)
│   ├── features/
│   │   ├── overview/README.md         # owner M1
│   │   ├── field-detail/README.md     # owner M1
│   │   ├── insights/README.md         # owner M1
│   │   ├── live/README.md             # owner M2
│   │   ├── devices/README.md          # owner M2
│   │   ├── alerts/README.md           # owner M3
│   │   ├── quality/README.md          # owner M3
│   │   └── analytics/README.md        # owner M4
│   ├── components/ui/                 # shadcn primitives (kept)
│   ├── components/shared/.gitkeep     # shared UI, owner M4
│   ├── lib/
│   │   ├── env.ts                     # kept
│   │   ├── utils.ts                   # kept
│   │   ├── api/.gitkeep               # adapter, schemas, shared hooks, owner M2
│   │   └── mock/.gitkeep              # seeded base dataset, owner M3
│   └── types/.gitkeep                 # contract types, owner M2
└── tests/                             # generic setup only
```

Each `features/<name>/README.md` is a short file stating: owner (M1–M4), business requirements, the pages and endpoints it will cover, and the line `Previous implementation (for reference only): git tag archive/webapp-v1, path <old path if known>`. Owners and requirement mapping:

| Member | Requirements | Features |
|---|---|---|
| M1 | BR1, BR7 | overview, field-detail, insights |
| M2 | BR2, BR3 | live, devices |
| M3 | BR4, BR8 | alerts, quality |
| M4 | BR5, BR6 | analytics |

## 4. Docs and housekeeping

- Update `web/README.md`: remove mentions of removed features. Keep and verify the sections on setup, `DATA_MODE=mock|api`, environment variables, Vercel deployment (Root Directory, Bun install/build commands, preview vs production) and how to expose a FastAPI backend over HTTPS. Add a short "Project structure and ownership" section with the tree and ownership table above, and mention the `archive/webapp-v1` tag.
- Make sure `.env.example` lists exactly: `DATA_MODE` (default `mock`), `API_BASE_URL`, `API_KEY`, `APP_PASSWORD`, `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_TIMEZONE` (default `Asia/Ho_Chi_Minh`), with comments. If `env.ts` differs, align it, and note the difference in the report.
- Add `.github/pull_request_template.md` with a short checklist: requirement IDs touched, screenshots for UI changes, lint/typecheck/test/build pass, only owned folders edited, contract changes noted.
- Ensure Vitest does not fail when there are no feature tests: keep one trivial test (for example, that `env.ts` parses the defaults) or set `passWithNoTests`.

## 5. Make the commits clean

Use small commits on `chore/reset-to-baseline`, for example:
1. `chore(web): remove feature implementation (kept in archive/webapp-v1)`
2. `chore(web): add placeholder routes and feature ownership folders`
3. `docs(web): update README, env example and PR template`

Use `git rm` for removals so history shows them as deletions.

## 6. Verify (all must pass, fix problems before reporting)

1. `bun install --frozen-lockfile` (update `bun.lock` and commit it if you removed dependencies, then re-run with `--frozen-lockfile`)
2. `bun run lint`
3. `bun run typecheck`
4. `bun run test`
5. `bun run build` with `DATA_MODE=mock`
6. Start `bun run dev` and confirm every placeholder route returns 200 and renders its placeholder text: `/`, `/live`, `/devices`, `/alerts`, `/quality`, `/analytics`, `/insights`, `/fields/f1`.
7. Search the codebase for leftover imports of removed modules, dead exports, unused files and unused dependencies (for example with `bunx knip` or a manual check), and clean up what is clearly dead.

## 7. Deliver

- Push `chore/reset-to-baseline` and open a pull request to `main` if the GitHub CLI is available. Otherwise print the exact commands I should run.
- Do not merge it yourself.

Final report (concise):
- The archive tag and branch names, and the baseline branch name
- The keep/remove/placeholder table (grouped, not every file if the list is long)
- Dependencies removed or kept, with reasons for anything uncertain
- Results of each verification step
- Anything you flagged or couldn't verify (for example the app not being in `web/`, Vercel behavior after merge, differences in env variables)
- A note that after merge, the Vercel deployment will show placeholder pages until members build their parts