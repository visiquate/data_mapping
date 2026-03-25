# How to Contribute to the Payer Mapping Tool

## First Time Setup

```bash
git clone git@github.com:visiquate/data_mapping.git
cd data_mapping
npm install
npm run convert-payers
npm run db:init
```

Then create a file called `.dev.vars` in the project root with this line:
```
SESSION_SECRET=any-random-string-for-local-dev
```

## Running Locally

```bash
npm run dev
```

Opens at http://localhost:5173

## Making Changes

1. Create a branch for your work:
   ```bash
   git checkout -b my-feature
   ```

2. Make your changes and test locally with `npm test`

3. Commit and push:
   ```bash
   git add <files>
   git commit -m "What you changed and why"
   git push -u origin my-feature
   ```

4. Open a pull request:
   ```bash
   gh pr create
   ```

5. Automated checks will run on your PR. If they pass, you can merge. If they fail, push a fix and they'll re-run.

6. When you merge, the site updates automatically at https://payer-mapping.visiquate.com within about a minute.

## Rules

- Never push directly to `main` — it's protected. Always use a pull request.
- Run `npm test` before pushing to catch problems early.
- The automated checks (build + tests) must pass before you can merge.
