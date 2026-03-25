# Development Setup (macOS)

## Prerequisites

- **Node.js 20+**: `brew install node`
- **Git**: `brew install git`

## 1. GitHub CLI (`gh`)

Used for creating PRs, checking CI status, and merging.

### Install

```bash
brew install gh
```

### Authenticate

```bash
gh auth login
```

Choose:
- GitHub.com
- SSH (recommended)
- Login with a web browser

### Verify

```bash
gh auth status
```

You should see your account name and `repo` scope.

### Useful commands for this repo

```bash
gh pr create                    # open a pull request
gh pr list                      # see open PRs
gh pr checks <number>           # check CI status
gh pr merge <number> --squash   # merge after CI passes
gh issue list                   # see open issues
```

## 2. Claude Code CLI

Used for coding, code review, and the `/deploy` and `/review` skills in this repo.

### Install

```bash
brew install claude-code
```

Or via npm:

```bash
npm install -g @anthropic-ai/claude-code
```

### Authenticate

```bash
claude auth login
```

This opens a browser to sign in with your Anthropic account.

### Using with this repo

```bash
cd data_mapping
claude
```

Inside Claude Code, the repo's custom skills are available:

- `/deploy` — Branch, review, and deploy changes to production via PR
- `/review` — Run code review and security audit on current changes

### Verify

```bash
claude --version
```

## 3. Codex CLI (Optional)

Used for additional AI code review via the `/deploy` skill's Codex review loop.

### Install

```bash
brew install codex
```

Or via npm:

```bash
npm install -g @openai/codex
```

### Authenticate

```bash
codex auth login
```

### Verify

```bash
codex --version
```

## 4. Clone and Set Up the Project

```bash
git clone git@github.com:visiquate/data_mapping.git
cd data_mapping
npm install
npm run convert-payers
npm run db:init
```

Create `.dev.vars` in the project root:

```
SESSION_SECRET=any-random-string-for-local-dev
```

Seed a local admin account (passphrase "admin" for dev):

```bash
npx wrangler d1 execute payer-mapping-db --local \
  --command="INSERT INTO admin_config (id, passphrase_hash) VALUES (1, '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918')"
```

## 5. Run Locally

```bash
npm run dev
```

This starts:
- Worker API on http://localhost:8787
- Frontend on http://localhost:5173

## 6. Run Tests

```bash
npm test           # run once
npm run test:watch # watch mode
```

## 7. Daily Workflow

```bash
git checkout -b my-feature    # create a branch
# make changes
npm test                      # test locally
git add <files>
git commit -m "What and why"
git push -u origin my-feature
gh pr create                  # open PR — CI runs automatically
# once CI passes:
gh pr merge --squash          # merge — auto-deploys to production
```

Or from inside Claude Code:

```
/deploy "description of changes"
```

This handles the full branch, review, PR, and merge workflow automatically.
