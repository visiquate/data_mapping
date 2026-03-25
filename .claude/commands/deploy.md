---
description: "Branch, review, and deploy changes to production via PR"
allowed-tools: Bash(git:*), Bash(gh:*), Bash(npm:*), Bash(npx:*), Read, Grep, Glob, Agent
argument-hint: "[commit message]"
---

# Deploy Workflow

Commit current changes, run review loops, open a PR, and merge to trigger auto-deploy.

**You are the orchestrator. Delegate ALL code review and fixes to specialist agents.**

## Phase 1: Prepare Branch & Commit

1. Check current branch:
   - If on `main`, create a feature branch: `git checkout -b deploy/<short-slug>`
   - If already on a feature branch, stay on it

2. Stage and commit:
   - Run `git status` and `git diff HEAD` to see all changes
   - Stage relevant files (never stage `.env`, `.dev.vars`, or secrets)
   - Commit with message from `$ARGUMENTS`, or generate a descriptive one from the diff

## Phase 2: Pre-flight Checks

Run locally before pushing:

1. `npm run convert-payers` — regenerate payer data
2. `npx tsc --noEmit` — TypeScript check
3. `npm run build` — Vite frontend build
4. `npm test` — run all tests

If any step fails, report the error and stop. Do not push broken code.

## Phase 3: Code Review Loop

Repeat until both reviewers return clean:

1. Spawn **code-reviewer** (sonnet) AND **security-auditor** (sonnet) in parallel.
   - Provide the full diff: `git diff main...HEAD`
   - Ask for HIGH SIGNAL issues only — bugs, security vulnerabilities, data integrity problems.
   - Do NOT flag style, naming, or subjective concerns.

2. If either returns actionable findings:
   - Delegate fixes to the appropriate specialist agent (haiku tier).
   - Re-run tests: `npm test`
   - Commit fixes.

3. Repeat until both reviewers return clean.

## Phase 4: Codex Review Loop (Optional)

If the `mcp__plugin_cco_codex__codex` tool is available:

1. Request a Codex code review of the changed files.
2. If Codex returns actionable findings, delegate fixes to specialist agents.
3. Re-run tests.
4. Repeat until Codex returns clean.

If the Codex tool is not available, skip this phase.

## Phase 5: Push & Open PR

1. Push the branch: `git push -u origin <branch>`
2. Open a PR:
   ```
   gh pr create --title "<title>" --body "$(cat <<'EOF'
   ## Summary
   <bullet points from the diff>

   ## Review
   - Code review: passed (internal)
   - Security review: passed (internal)
   - Tests: passed (npm test)

   ## Deploy
   Merging this PR will auto-deploy to https://payer-mapping.visiquate.com
   EOF
   )"
   ```

## Phase 6: Merge

1. Wait for CI to pass: `gh pr checks <PR-number> --watch`
2. Once CI passes, merge: `gh pr merge <PR-number> --squash --delete-branch`
3. Report the merge and confirm deploy will trigger.

## Notes

- CI runs automatically on the PR (typecheck + build + tests).
- Merging to `main` triggers auto-deploy to Cloudflare (Worker + Pages).
- The full deploy takes about 40 seconds after merge.
- If CI fails on the PR, fix locally, commit, and push — it re-runs automatically.
