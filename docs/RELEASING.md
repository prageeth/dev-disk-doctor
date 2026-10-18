# Releasing dev-disk-doctor

How to publish a new version to npm, and how to check it worked. Publishing is automated by [`.github/workflows/release.yml`](../.github/workflows/release.yml): pushing a version tag (`v*`) builds, tests and publishes the package, then creates a GitHub release.

## One-time setup

Only needed once per repo, or when the token expires.

### 1. Create an npm token

1. Sign in at [npmjs.com](https://www.npmjs.com) → your avatar → **Access Tokens** → **Generate New Token** → **Granular Access Token**.
2. Permissions: **Read and write** for **All packages**.
   - Use "All packages" only for the very first publish, when `dev-disk-doctor` does not exist on npm yet and the token cannot be limited to it. After the first release you can replace the token with one limited to this package.
3. If your npm account requires 2FA to publish, enable the option that lets the token **bypass 2FA**. Otherwise CI cannot publish.
4. Set an expiry (90 days is reasonable) and copy the token. npm shows it once.

### 2. Store it as a repo secret

In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**, name `NPM_TOKEN`.

Or from a terminal (prompts for the value, so it stays out of your shell history):

```bash
gh secret set NPM_TOKEN -R pureartisan/dev-disk-doctor
```

Check it is there (shows the name only, never the value):

```bash
gh secret list -R pureartisan/dev-disk-doctor
```

### 3. Rotate before it expires

When the token expires, publishing fails with a 401/403. Create a new token, then run `gh secret set NPM_TOKEN` again. Nothing else changes.

## Releasing a version

Start from a clean, up-to-date `main` with the changes you want to ship already merged.

```bash
git checkout main && git pull
npm test                      # same check the workflow runs
```

**First release ever** (`package.json` already says `0.1.0`): tag it as is, without bumping.

```bash
git tag v0.1.0
git push origin v0.1.0
```

**Every release after that**: let npm bump the version and create the tag.

```bash
npm version patch             # or minor / major
git push --follow-tags
```

Which bump:

| Change | Command |
|---|---|
| Bug fix, new detector, wording | `npm version patch` |
| New command or option, new MCP tool | `npm version minor` |
| Breaking change to CLI flags, JSON output schema or MCP tool names | `npm version major` |

Version numbers on npm can never be reused. If a published version is bad, ship a fixed one and run `npm deprecate dev-disk-doctor@<bad> "use <fixed>"`.

## What the workflow does

1. Checks out the tagged commit and runs `npm ci`.
2. Fails if the tag does not equal `v` + the `package.json` version.
3. Runs `npm test` (build plus the test suite).
4. Runs `npm publish --provenance --access public`. Provenance links the npm package to this exact workflow run.
5. Creates a GitHub release with generated notes.

Watch it:

```bash
gh run list -R pureartisan/dev-disk-doctor --workflow Release --limit 3
gh run watch -R pureartisan/dev-disk-doctor
```

## Verify a release

Run these from a different folder than the repo, so you test the published package and not your local build.

```bash
cd "$(mktemp -d)"

# 1. The version is on npm and is the one you expect
npm view dev-disk-doctor version
npm view dev-disk-doctor dist.tarball

# 2. It runs from a clean machine state (bypasses any local cache)
npx --yes dev-disk-doctor@latest --version
npx --yes dev-disk-doctor@latest roots
npx --yes dev-disk-doctor@latest worktrees --json | head

# 3. The MCP server starts and lists its tools
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | npx --yes dev-disk-doctor@latest mcp | grep -o '"name":"[a-z_]*"'
```

Expected from the last command: `disk_scan`, `worktree_audit`, `explain_finding`, `apply_action`.

Also check by eye:

- The package page at `https://www.npmjs.com/package/dev-disk-doctor` shows the new version and a **Provenance** badge.
- The GitHub **Releases** page has a release for the tag.
- The README renders correctly on the npm page.

### Dry run before tagging

See exactly what would be published without publishing anything:

```bash
npm pack --dry-run
```

The tarball should contain `dist/src`, `skills/`, `README.md` and `LICENSE`, and nothing else (no `test/`, no `node_modules`).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Workflow did not start | The tag must start with `v` and be pushed (`git push origin vX.Y.Z` or `--follow-tags`). The workflow file must already be on `main`. |
| "Tag … does not match package.json version" | Tag and `package.json` disagree. If nothing was published, delete the tag and redo it (below). |
| `npm error 401` / `403` on publish | Token missing, expired, or lacks write access. If the account enforces 2FA, the token must bypass 2FA. Update the secret and re-run. |
| `403 … cannot publish over the previously published versions` | That version already exists on npm. Bump the version and tag again. |
| `npm error code E404` on first publish | The token is limited to specific packages. The first publish needs "All packages" (see setup). |
| Provenance error | The repo must be public and the workflow must keep `id-token: write`. |

Re-do a tag that **failed before publishing** (safe because nothing reached npm):

```bash
git push origin :refs/tags/vX.Y.Z   # delete the remote tag
git tag -d vX.Y.Z                   # delete the local tag
# fix the problem, merge to main, then:
git tag vX.Y.Z && git push origin vX.Y.Z
```

Never do this for a version that already shows on npm.
