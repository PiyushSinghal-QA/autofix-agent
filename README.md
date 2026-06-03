# autofix-agent

The autonomous **bug → Trello card → AI fix → GitHub PR** worker. It treats
**checkout-service** as the target repo and **checkout-e2e** as the source of
truth for correctness.

## The loop

```
detect → card → branch → AI fix → validate → review → PR
```

1. **detect** — checks out a `bug/*` branch in a throwaway worktree, builds + starts the app, and
   runs the **checkout-e2e** suite against it. The failing test = the bug.
2. **card** — files a Trello card (simulated in dry-run).
3. **branch** — creates a `fix/*` branch off the bug branch.
4. **AI fix** — the provider returns a minimal unified diff (mock = canonical fixture; Claude = real).
   A diff policy rejects >3 files, dependency changes, or test edits *before* applying.
5. **validate** — rebuilds + re-runs the **checkout-e2e** suite against the patched app. On failure
   it aborts and reverts — no PR.
6. **review** (dashboard default) — pauses with the diff + result; **Approve** to open the PR or **Discard**.
7. **PR** — pushes the fix branch and opens a pull request on `checkout-service`.

Every stage streams to the dashboard over SSE; the same flow runs headless via the CLI.

## Run it

```bash
npm install
npm run seed:fixtures        # generate the mock provider's fix patches from checkout-service
npm run demo                 # build + start the agent + dashboard → http://localhost:4000
```

Assumes `../checkout-service` and `../checkout-e2e` are checked out beside this repo
(override with `APP_PATH` / `E2E_PATH`). Headless single run:

```bash
npm run pipeline -- <bugId>          # e.g. null-check   (auto-approves → opens a PR)
```

## What's real vs simulated

| | Default | Real |
|--|---------|------|
| AI fix | `mock` (deterministic patch + simulated latency/tokens) | `AI_PROVIDER=claude` + `ANTHROPIC_API_KEY` |
| Trello | dry-run (logged) | `DRY_RUN=false` + `TRELLO_*` |
| GitHub | dry-run (simulated PR) | `DRY_RUN=false` + `GITHUB_*` |
| Detect / validate | **always real** — builds + runs the checkout-e2e suite against the app | — |

## Related repos

- **checkout-service** — the app the agent fixes.
- **checkout-e2e** — the black-box suite the agent runs.
