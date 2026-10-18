import { promises as fs } from 'node:fs';
import path from 'node:path';
import { run } from '../core/exec.js';
import { sizeOf } from '../core/size.js';
import { daysAgo, isDir, pathExists } from '../core/util.js';
import type { ScanOptions } from '../core/types.js';
import { discover, realpathSafe, repoFromGitdir, toolWorktreeRoots, parseGitFile } from './discover.js';
import type { OrphanDir, RepoAudit, WorktreeAudit, WorktreeInfo, WorktreeStatus } from './types.js';

interface Listed {
  path: string;
  head?: string;
  branch?: string;
  detached: boolean;
  locked: boolean;
  lockReason?: string;
  prunable: boolean;
  bare: boolean;
}

export function parseWorktreeList(porcelain: string): Listed[] {
  const out: Listed[] = [];
  for (const block of porcelain.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter(Boolean);
    if (!lines.length) continue;
    const w: Listed = { path: '', detached: false, locked: false, prunable: false, bare: false };
    for (const line of lines) {
      const [key, ...rest] = line.split(' ');
      const val = rest.join(' ');
      if (key === 'worktree') w.path = val;
      else if (key === 'HEAD') w.head = val;
      else if (key === 'branch') w.branch = val.replace(/^refs\/heads\//, '');
      else if (key === 'detached') w.detached = true;
      else if (key === 'bare') w.bare = true;
      else if (key === 'locked') {
        w.locked = true;
        w.lockReason = val || undefined;
      } else if (key === 'prunable') w.prunable = true;
    }
    if (w.path) out.push(w);
  }
  return out;
}

function toolOwner(p: string): WorktreeInfo['toolOwned'] {
  const s = p.split(path.sep).join('/');
  if (s.includes('/.claude/worktrees/')) return 'claude';
  if (s.includes('/.codex/worktrees/')) return 'codex';
  if (s.includes('/.cursor/worktrees/')) return 'cursor';
  if (s.includes('/conductor/')) return 'conductor';
  if (s.includes('/.worktrees/')) return 'worktrees-dir';
  return undefined;
}

async function git(cwd: string, args: string[], timeoutMs = 20_000) {
  return run('git', ['-C', cwd, ...args], { timeoutMs });
}

async function defaultRef(repo: string): Promise<string | undefined> {
  const head = await git(repo, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']);
  if (head.ok && head.stdout.trim()) return head.stdout.trim();
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    const r = await git(repo, ['rev-parse', '--verify', '-q', ref]);
    if (r.ok) return ref;
  }
  return undefined;
}

async function mtimeMs(p: string): Promise<number | undefined> {
  try {
    return (await fs.stat(p)).mtimeMs;
  } catch {
    return undefined;
  }
}

async function inspectLinked(l: Listed, repo: string, defRef: string | undefined, opts: ScanOptions): Promise<WorktreeInfo> {
  const info: WorktreeInfo = {
    repo,
    path: l.path,
    isMain: false,
    branch: l.branch,
    head: l.head,
    detached: l.detached,
    locked: l.locked,
    lockReason: l.lockReason,
    exists: await isDir(l.path),
    prunable: l.prunable,
    toolOwned: toolOwner(l.path),
    status: 'active',
    reason: '',
  };

  if (!info.exists || info.prunable) {
    info.status = 'prunable';
    info.reason = 'The folder is gone but git still has a record of it.';
    return info;
  }

  const [status, unpushed, merged, commitTime, size] = await Promise.all([
    git(l.path, ['status', '--porcelain']),
    git(l.path, ['rev-list', '--count', 'HEAD', '--not', '--remotes']),
    defRef ? git(l.path, ['merge-base', '--is-ancestor', 'HEAD', defRef]) : Promise.resolve(undefined),
    git(l.path, ['log', '-1', '--format=%ct']),
    sizeOf(l.path, opts.detectorTimeoutMs),
  ]);

  info.dirty = status.ok ? status.stdout.trim().length > 0 : undefined;
  info.unpushed = unpushed.ok ? Number(unpushed.stdout.trim()) : undefined;
  info.merged = merged ? merged.ok : undefined;
  info.bytes = size;

  const gitdir = await parseGitFile(l.path);
  const times = [
    commitTime.ok ? Number(commitTime.stdout.trim()) * 1000 : undefined,
    gitdir ? await mtimeMs(path.join(gitdir, 'index')) : undefined,
    gitdir ? await mtimeMs(path.join(gitdir, 'HEAD')) : undefined,
    await mtimeMs(l.path),
  ].filter((t): t is number => t !== undefined && Number.isFinite(t));
  if (times.length) {
    info.lastActivityMs = Math.max(...times);
    info.idleDays = daysAgo(info.lastActivityMs);
  }

  Object.assign(info, classify(info, opts.staleDays));
  return info;
}

export function classify(
  w: Pick<WorktreeInfo, 'locked' | 'lockReason' | 'dirty' | 'unpushed' | 'merged' | 'idleDays'>,
  staleDays: number,
): { status: WorktreeStatus; reason: string } {
  if (w.locked) return { status: 'locked', reason: `Locked${w.lockReason ? ` (${w.lockReason})` : ''}; git will not remove it.` };
  if (w.dirty === undefined || w.unpushed === undefined) {
    return { status: 'at-risk', reason: 'Could not read its git state, so it is not safe to assume it is disposable.' };
  }
  const problems: string[] = [];
  if (w.dirty) problems.push('has uncommitted or untracked changes');
  if (w.unpushed > 0 && !w.merged) problems.push(`has ${w.unpushed} commit${w.unpushed === 1 ? '' : 's'} no remote has`);
  if (problems.length) return { status: 'at-risk', reason: `Work would be lost: it ${problems.join(' and ')}.` };
  const idle = w.idleDays ?? 0;
  if (idle >= staleDays) {
    return {
      status: 'stale',
      reason: `Clean, ${w.merged ? 'merged into the default branch' : 'fully pushed'}, and idle for ${idle} days.`,
    };
  }
  return { status: 'active', reason: `Touched ${idle} day${idle === 1 ? '' : 's'} ago.` };
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function auditWorktrees(opts: ScanOptions): Promise<WorktreeAudit> {
  const roots = [...new Set([...opts.roots, ...toolWorktreeRoots(opts.home)])];
  const found = await discover(roots);

  // Repos come from two places: the walk, and the repos that stray worktrees point back to.
  const repoSet = new Map<string, string>(); // realpath → path
  for (const r of found.repos) repoSet.set(await realpathSafe(r), r);
  for (const l of found.linked) {
    const repo = repoFromGitdir(l.gitdir);
    if (repo && (await pathExists(path.join(repo, '.git')))) repoSet.set(await realpathSafe(repo), repo);
  }

  const known = new Set<string>();
  const audits: RepoAudit[] = [];
  await pool([...repoSet.values()], 4, async (repo) => {
    const list = await git(repo, ['worktree', 'list', '--porcelain']);
    if (!list.ok) return;
    const listed = parseWorktreeList(list.stdout).filter((w) => !w.bare);
    const defRef = await defaultRef(repo);
    const repoReal = await realpathSafe(repo);
    const worktrees: WorktreeInfo[] = [];
    const linked: Listed[] = [];
    for (const w of listed) {
      known.add(await realpathSafe(w.path));
      if ((await realpathSafe(w.path)) === repoReal) {
        worktrees.push({
          repo, path: w.path, isMain: true, branch: w.branch, head: w.head, detached: w.detached, locked: false,
          exists: true, prunable: false, status: 'active', reason: 'Main working copy.',
        });
      } else linked.push(w);
    }
    worktrees.push(...(await pool(linked, 6, (w) => inspectLinked(w, repo, defRef, opts))));
    audits.push({ repo, defaultBranch: defRef, worktrees });
  });

  // Folders carrying a worktree `.git` file that no repository lists any more.
  const orphans: OrphanDir[] = [];
  for (const l of found.linked) {
    if (known.has(await realpathSafe(l.dir))) continue;
    const gitdirExists = await pathExists(l.gitdir);
    if (gitdirExists) continue; // still registered somewhere we did not list; leave it alone
    const bytes = await sizeOf(l.dir, opts.detectorTimeoutMs);
    const mt = await mtimeMs(l.dir);
    orphans.push({
      path: l.dir,
      gitdir: l.gitdir,
      bytes,
      idleDays: mt ? daysAgo(mt) : undefined,
      reason: 'Its repository no longer knows about it (the repo was moved, deleted, or the worktree record was pruned). Git can no longer tell you if it holds unsaved work.',
    });
  }

  audits.sort((a, b) => a.repo.localeCompare(b.repo));
  const byStatus: Record<WorktreeStatus, number> = { active: 0, stale: 0, prunable: 0, 'at-risk': 0, locked: 0 };
  let linkedCount = 0;
  let reposWith = 0;
  let bytes = 0;
  for (const a of audits) {
    const l = a.worktrees.filter((w) => !w.isMain);
    if (l.length) reposWith++;
    linkedCount += l.length;
    for (const w of l) {
      byStatus[w.status]++;
      bytes += w.bytes ?? 0;
    }
  }
  bytes += orphans.reduce((s, o) => s + (o.bytes ?? 0), 0);

  return {
    rootsScanned: roots,
    repos: audits,
    orphans,
    totals: { repos: audits.length, reposWithLinkedWorktrees: reposWith, linkedWorktrees: linkedCount, byStatus, orphans: orphans.length, bytes },
  };
}
