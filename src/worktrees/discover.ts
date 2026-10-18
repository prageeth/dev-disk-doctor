import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isDir, readText } from '../core/util.js';

const SKIP = new Set([
  'node_modules', '.git', 'Library', '.Trash', 'vendor', 'Pods', 'target', 'build', 'dist',
  '.next', 'venv', '.venv', '__pycache__', '.gradle', '.cache', '.npm', '.cargo', '.rustup',
]);
const HIDDEN_OK = new Set(['.claude', '.codex', '.cursor', '.worktrees', '.conductor']);
const MAX_DEPTH = 7;
const MAX_DIRS = 400_000;

export interface Discovery {
  /** Main working copies (a `.git` directory). */
  repos: string[];
  /** Folders that contain a `.git` *file* pointing at a linked worktree's metadata. */
  linked: { dir: string; gitdir: string }[];
}

export async function realpathSafe(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return path.resolve(p);
  }
}

/** Where AI coding tools tend to park worktrees. Included automatically when present. */
export function toolWorktreeRoots(home: string): string[] {
  return [
    path.join(home, '.codex/worktrees'),
    path.join(home, '.cursor/worktrees'),
    path.join(home, '.claude/worktrees'),
    path.join(home, 'conductor'),
  ];
}

export async function parseGitFile(dir: string): Promise<string | undefined> {
  const text = await readText(path.join(dir, '.git'));
  const m = text && /^gitdir:\s*(.+)$/m.exec(text);
  if (!m) return undefined;
  const raw = m[1].trim();
  return path.isAbsolute(raw) ? raw : path.resolve(dir, raw);
}

/** `<repo>/.git/worktrees/<name>` → `<repo>`; anything else (submodules etc.) → undefined. */
export function repoFromGitdir(gitdir: string): string | undefined {
  const parent = path.dirname(gitdir);
  if (path.basename(parent) !== 'worktrees') return undefined;
  const dotGit = path.dirname(parent);
  if (path.basename(dotGit) !== '.git') return undefined;
  return path.dirname(dotGit);
}

export async function discover(roots: string[]): Promise<Discovery> {
  const repos = new Set<string>();
  const linked = new Map<string, string>();
  let visited = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || visited++ > MAX_DIRS) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const dotGit = entries.find((e) => e.name === '.git');
    if (dotGit?.isDirectory()) repos.add(dir);
    else if (dotGit?.isFile()) {
      const gitdir = await parseGitFile(dir);
      if (gitdir && gitdir.includes(`${path.sep}worktrees${path.sep}`)) linked.set(dir, gitdir);
      return; // a linked worktree is a leaf; its content belongs to that worktree
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name)) continue;
      if (e.name.startsWith('.') && !HIDDEN_OK.has(e.name)) continue;
      await walk(path.join(dir, e.name), depth + 1);
    }
  }

  for (const r of roots) if (await isDir(r)) await walk(r, 0);
  return { repos: [...repos], linked: [...linked].map(([dir, gitdir]) => ({ dir, gitdir })) };
}
