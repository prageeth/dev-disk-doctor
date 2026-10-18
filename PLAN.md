# dev-disk-doctor: plan

Repo: https://github.com/prageeth/dev-disk-doctor · npm: `dev-disk-doctor` (unclaimed) · License: MIT

## Problem

Developer machines fill up with things nobody remembers creating: a 250 GB Docker disk image, 15 Android emulator system images, package-manager stores, ML models, `node_modules` in dead projects, and, increasingly, git worktrees that AI coding tools (Claude Code, Codex, Cursor, Conductor) create and sometimes orphan. macOS "Storage" lumps most of this into one opaque category called "Documents", which is why a 3.5 GB `~/Documents` shows up as 230 GB.

## Goals

1. **Read-only by default.** Scanning never changes anything.
2. **Explain, don't just list.** Every finding says what it is, why it is big, whether it regenerates, and what deleting it costs.
3. **Ready-to-run fixes with warnings.** Each finding carries actions: the exact command, expected reclaim, risk level, warning text.
4. **Agent-first.** Runs as `npx dev-disk-doctor scan --json`, as an MCP server, and ships a skill file so an agent can run it, present options and ask before anything destructive.
5. **Worktree audit across all repos.** Find every git repo under the user's workspaces, list every linked worktree, and flag stale, orphaned, dirty or unpushed ones.

Non-goals (v1): Windows, GUI, telemetry or any network access, general-purpose duplicate-file finder, deleting anything without an explicit confirm.

## Safety model

| Risk | Meaning | Tool behaviour |
|---|---|---|
| `safe` | Regenerates automatically (caches, build output) | Action may be applied after confirmation |
| `review` | Probably fine but user data may be involved (old images, models, stale worktrees) | Applied only with explicit per-finding confirmation |
| `danger` | Could lose unrecoverable data (volumes, dirty worktrees, unpushed commits, VM disks) | Never applied by the tool; command is shown with a warning only |

- No arbitrary command execution: actions come from an allowlist built by detectors and are referenced by id (`docker.images:prune`), never by free text.
- Dry run is the default for `fix`; `--yes` is required to execute. The MCP `apply_action` tool requires `confirm: true`.
- Worktrees are only offered for removal when clean, unlocked, and fully merged or pushed. Anything else is `review` or `danger` and explained.
- Everything runs locally. No network, no telemetry.

## Architecture

TypeScript, Node >= 18, one runtime dependency for the MCP server (`@modelcontextprotocol/sdk`, `zod`). The core and CLI use only Node built-ins.

```
src/
  core/
    types.ts        Finding, Action, Risk, ScanOptions
    exec.ts         spawn without a shell, timeout, output cap
    size.ts         du-based sizing (allocated bytes), parallel limit, timeout
    scan.ts         runs detectors, sorts, totals
    fix.ts          allowlisted action runner (dry-run default)
  detectors/
    docker.ts       Docker.raw / docker system df, images, build cache, volumes (volumes are `danger`)
    android.ts      sdk/system-images per image, AVDs referencing them (never flags an image an AVD uses)
    xcode.ts        DerivedData, simulators (unavailable), DeviceSupport, Archives
    pkgcaches.ts    npm, pnpm (stores by version, flags the active one), yarn, bun, pip, uv, conda, Homebrew, Cargo, Gradle, CocoaPods
    browsers.ts     Playwright, Puppeteer, Cypress downloads
    models.ts       Hugging Face, Ollama, DiffusionBee, LM Studio, torch hub
    projects.ts     node_modules and build dirs (.next, target, build, dist, .venv) in workspaces, stale by mtime
    system.ts       Trash, Downloads large files, logs, Time Machine local snapshots, iOS backups
    biggest.ts      fallback: top-level sizes of $HOME and ~/Library so unknown hogs still surface
  worktrees/
    discover.ts     find repos under workspace roots + known tool locations
    inspect.ts      git worktree list --porcelain, dirty/unpushed/merged/age per worktree
    classify.ts     orphaned, prunable, stale, active, risk
  report/
    text.ts         human report (colour only on a TTY)
    json.ts         stable schema for agents
    markdown.ts
  cli.ts            scan | worktrees | explain <id> | fix <id>:<action> | mcp
  mcp.ts            stdio MCP server
skills/dev-disk-doctor/SKILL.md   agent playbook
```

### Worktree audit details

- **Discovery:** walk workspace roots (default `~/dev ~/code ~/src ~/projects ~/work ~/workspace`, overridable with `--root`) to a bounded depth, skipping `node_modules`. A repo is a directory with a `.git` directory. Also check known locations used by AI tools: `<repo>/.claude/worktrees`, `~/.codex/worktrees`, `~/.cursor/worktrees`, `~/conductor`.
- **Per linked worktree:** path, branch or detached HEAD, last commit date, size, dirty (`status --porcelain`), commits not on any remote, merged into the default branch, locked, whether the path exists.
- **Orphan classes:** (a) *prunable*: git lists it but the directory is gone; (b) *detached orphan*: a directory whose `.git` file points at a repo or worktree entry that no longer exists; (c) *stale*: no commits and no file changes for N days (default 14) and merged or pushed; (d) *tool-owned*: lives under an AI-tool worktree directory.
- **Output:** per-repo counts, total worktrees across all repos, total size, and a ranked list with a one-line reason each.
- **Actions:** `git worktree prune` (safe), `git worktree remove <path>` (review, only clean + merged/pushed), `git branch -d` for merged leftovers (review). Dirty or unpushed worktrees get a `danger` finding with a warning and no apply path.

### MCP surface

| Tool | Purpose |
|---|---|
| `disk_scan` | Run detectors, return summary + findings (filterable by category, min size) |
| `worktree_audit` | Run the worktree audit across roots |
| `explain_finding` | Detail, risks and actions for one finding id |
| `apply_action` | Execute one allowlisted action; `confirm: true` required; refuses `danger` |

All tools return structured JSON plus a short text summary. Scans have per-detector timeouts and report which detectors were skipped or slow.

## Milestones

1. **Scaffold + core**: package, tsconfig, types, exec, size, scan loop.
2. **Detectors**: docker, android, xcode, pkgcaches, browsers, models, projects, system, biggest.
3. **Worktree audit**: discover, inspect, classify; tested against temp repos with real `git worktree` setups.
4. **CLI + reports**: text/JSON/markdown, `fix` with dry-run default.
5. **MCP server + skill file**.
6. **Tests + CI** (`node:test`, GitHub Actions on macOS and Ubuntu), README with SEO-oriented sections ("Why is my Mac Documents folder so big?", "Docker.raw too large", "Delete old Android system images", "Find stale git worktrees"), npm publish setup.

## Verification

- Unit tests per detector using fake home directories under a temp dir (detectors take a `home` option).
- Worktree tests create real repos and worktrees in a temp dir, then orphan them (delete the directory, delete the repo) and assert classification.
- Manual run on a real machine with the output compared against `du`.

## Open decisions (defaults chosen)

- Reclaim estimates are allocated bytes from `du`, not logical size (matters for sparse files like `Docker.raw`).
- Docker's disk image does not shrink after pruning on older Docker Desktop versions; the action warns and points at Docker Desktop's disk-image settings.
- Only macOS is tested in v1; Linux paths are best-effort.
