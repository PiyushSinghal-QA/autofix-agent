# autofix-agent

The autonomous **bug → fix → GitHub PR** worker — a standalone tool you point at
**any** app + test suite. It detects a failing test, generates a minimal fix
(real Claude or an offline mock), validates it against the suite, and opens a
pull request — with guardrails and a human approval gate.

> **The agent is the product.** `checkout-service` + `checkout-e2e` are just one
> **example target** (a demo cart app + its Playwright suite). To run it against
> your own system you change the *target config* below — nothing in the agent
> itself changes.

## The loop

```
detect → card → branch → AI fix → validate → review → PR
```

1. **detect** — runs the target's black-box suite against a throwaway worktree; failing tests are the bugs.
2. **card** — files a Trello card (simulated in dry-run).
3. **branch** — cuts a `fix/*` branch off the target's default branch.
4. **AI fix** — the provider returns a minimal unified diff (`claude` = real; `mock` = canned). A diff policy rejects >3 files, dependency changes, or test edits *before* applying.
5. **validate** — rebuilds + re-runs the suite against the patched app; the target test must pass and nothing else may regress. On failure it aborts and reverts — no PR.
6. **review** — pauses with the diff + result; **Approve** opens the PR, **Discard** drops it. (CLI/webhook auto-approve.)
7. **PR** — pushes the fix branch and opens a pull request into the target repo.

Every stage streams to the dashboard over SSE; the same flow runs headless via the CLI.

## Target contract — what swaps per deployment

Point the agent at your system entirely through `.env`; the tool is untouched:

| Setting | What it is |
|---|---|
| `APP_PATH` | path to the target app repo (the code it fixes) |
| `E2E_PATH` | path to the target's Playwright suite |
| `GITHUB_OWNER` / `GITHUB_REPO` | where PRs are opened |
| `APP_PORT` | port the app-under-test is started on |
| `AI_PROVIDER` + `ANTHROPIC_API_KEY` | `claude` for real fixes, `mock` for the offline demo |
| `DRY_RUN` | `false` to open real PRs / Trello cards |

The agent ships **zero target-specific data**. The demo target additionally ships
its own bug catalogue (`bugs/registry.json`) and canned fixes (`bugs/fixtures/`)
that power the offline `mock` provider — a real target needs **neither**: it uses
`AI_PROVIDER=claude` and live test results.

### Per-target commands (`autofix.config.json`)

*How* to install, run and test the target lives in an optional
`autofix.config.json` at the target app's root, so the agent stays
language-agnostic. Absent (the Node demo) → Node/Playwright defaults. A
PHP/Symfony target ships, for example:

```json
{
  "install": "composer install --no-interaction --no-progress",
  "build": "",
  "serve": "php -S 127.0.0.1:${PORT} -t public",
  "healthPath": "/health",
  "startTimeoutMs": 60000,
  "test": "npx playwright test --reporter=json"
}
```

`${PORT}` is substituted with `APP_PORT` (and set in the env). For a
container-based app use `"serve": "docker compose up -d"` + `"stop": "docker compose down -v"`.
The test command runs in `E2E_PATH` and must emit Playwright JSON.

## Run it (against the demo target)

```bash
npm install
npm run demo                 # build + start the agent + dashboard → http://localhost:4000
```

Assumes `../checkout-service` + `../checkout-e2e` are checked out beside this repo
(override with `APP_PATH` / `E2E_PATH`). Headless single run:

```bash
npm run pipeline -- <bugId>          # e.g. typo   (auto-approves → opens a PR)
```

## What's real vs simulated

| | Default (demo) | Real |
|--|---------|------|
| AI fix | `mock` (canned patch + simulated latency/tokens) | `AI_PROVIDER=claude` + `ANTHROPIC_API_KEY` |
| Trello | dry-run (logged) | `DRY_RUN=false` + `TRELLO_*` |
| GitHub | dry-run (simulated PR) | `DRY_RUN=false` + `GITHUB_*` |
| Detect / validate | **always real** — builds + runs the target's suite | — |
