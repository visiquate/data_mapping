---
description: "Run code review and security audit on current changes"
allowed-tools: Bash(git:*), Bash(npm:*), Bash(npx:*), Read, Grep, Glob, Agent
argument-hint: "[scope: 'staged', 'branch', or 'all']"
---

# Code Review

Run a code review and security audit on current changes without deploying.

**You are the orchestrator. Delegate ALL review to specialist agents.**

## Step 1: Determine Scope

Based on `$ARGUMENTS`:
- `staged` or no argument: review only staged changes (`git diff --cached`)
- `branch`: review all changes on this branch vs main (`git diff main...HEAD`)
- `all`: review all uncommitted changes (`git diff HEAD`)

## Step 2: Pre-flight

1. Run `npm test` — ensure tests pass before reviewing.
2. Run `npx tsc --noEmit` — ensure no type errors.
3. If either fails, report the error. Still proceed with review but note the failures.

## Step 3: Review Loop

Spawn **code-reviewer** (sonnet) AND **security-auditor** (sonnet) in parallel.

Provide each with:
- The diff from step 1
- The file list of changed files
- Instructions to focus on HIGH SIGNAL issues only:
  - Bugs that will cause runtime failures
  - Security vulnerabilities (XSS, injection, auth bypass, CORS issues)
  - Data integrity problems (incorrect mappings, lost data, race conditions)
  - HIPAA compliance gaps (audit logging, PHI exposure)

Do NOT flag:
- Style, naming, or formatting
- Subjective improvements
- Issues a linter would catch

## Step 4: Codex Review (Optional)

If the `mcp__plugin_cco_codex__codex` tool is available, also request a Codex review for a third perspective.

## Step 5: Report

Present findings as:

```
## Review Summary

### Critical (must fix)
- [file:line] Description

### Important (should fix)
- [file:line] Description

### Clean
- No issues found in: [list of clean files]
```

If findings exist, ask: "Want me to fix these issues?"

If no findings: "Review passed. No issues found."
