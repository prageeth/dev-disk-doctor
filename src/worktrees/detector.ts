import type { Detector, Finding, ScanOptions } from '../core/types.js';
import { execAction, manualAction, removeAction } from '../detectors/helpers.js';
import { auditWorktrees } from './audit.js';
import type { WorktreeAudit } from './types.js';

/** Turn an audit into findings. Active worktrees are not findings; they only show in the audit. */
export function auditToFindings(audit: WorktreeAudit, opts: Pick<ScanOptions, 'home'>): Finding[] {
  const findings: Finding[] = [];
  const short = (p: string) => p.replace(opts.home, '~');

  for (const a of audit.repos) {
    const prunable = a.worktrees.filter((w) => w.status === 'prunable');
    if (prunable.length) {
      const id = `worktrees:prune:${a.repo}`;
      findings.push({
        id,
        detector: 'worktrees',
        category: 'worktrees',
        title: `${prunable.length} dangling worktree record${prunable.length === 1 ? '' : 's'} in ${short(a.repo)}`,
        path: a.repo,
        bytes: 0,
        risk: 'safe',
        regenerable: true,
        why: `Git still lists worktrees whose folders were deleted: ${prunable.map((w) => short(w.path)).join(', ')}. Pruning removes only the stale records.`,
        actions: [execAction(id, 'prune', 'Run git worktree prune', 'git', ['worktree', 'prune'], 'safe', { cwd: a.repo })],
      });
    }

    for (const w of a.worktrees) {
      if (w.isMain || (w.status !== 'stale' && w.status !== 'at-risk' && w.status !== 'locked')) continue;
      const id = `worktrees:wt:${w.path}`;
      const label = `${short(w.path)}${w.branch ? ` [${w.branch}]` : w.detached ? ' [detached]' : ''}${w.toolOwned ? ` (${w.toolOwned})` : ''}`;
      if (w.status === 'stale') {
        findings.push({
          id,
          detector: 'worktrees',
          category: 'worktrees',
          title: `Stale worktree ${label} of ${short(a.repo)}`,
          path: w.path,
          bytes: w.bytes ?? 0,
          risk: 'review',
          regenerable: false,
          why: w.reason,
          actions: [
            execAction(id, 'remove', 'Remove this worktree (git worktree remove)', 'git', ['worktree', 'remove', w.path], 'review', {
              bytes: w.bytes,
              cwd: a.repo,
              warning: w.branch ? `The branch "${w.branch}" is kept; only the checkout folder is removed. Git refuses if anything changed since the scan.` : 'Git refuses if anything changed since the scan.',
            }),
          ],
          meta: { repo: a.repo, branch: w.branch, idleDays: w.idleDays, toolOwned: w.toolOwned },
        });
      } else {
        findings.push({
          id,
          detector: 'worktrees',
          category: 'worktrees',
          title: `${w.status === 'locked' ? 'Locked' : 'At-risk'} worktree ${label} of ${short(a.repo)}`,
          path: w.path,
          bytes: w.bytes ?? 0,
          risk: 'danger',
          regenerable: false,
          why: w.reason,
          actions: [
            manualAction(
              id,
              'inspect',
              'Look before deleting',
              `git -C ${JSON.stringify(w.path)} status && git -C ${JSON.stringify(w.path)} log --branches --not --remotes --oneline`,
              'danger',
              'This worktree may hold work that exists nowhere else. Commit and push it, or decide to discard it yourself.',
            ),
          ],
          meta: { repo: a.repo, branch: w.branch, idleDays: w.idleDays, dirty: w.dirty, unpushed: w.unpushed, toolOwned: w.toolOwned },
        });
      }
    }
  }

  for (const o of audit.orphans) {
    const id = `worktrees:orphan:${o.path}`;
    findings.push({
      id,
      detector: 'worktrees',
      category: 'worktrees',
      title: `Orphaned worktree folder ${short(o.path)}`,
      path: o.path,
      bytes: o.bytes ?? 0,
      risk: 'review',
      regenerable: false,
      why: o.reason,
      actions: [removeAction(id, o.path, 'review', o.bytes ?? 0, 'Open the folder first: files here are no longer tracked by git and cannot be recovered after deletion.')],
    });
  }
  return findings;
}

export const worktrees: Detector = {
  id: 'worktrees',
  title: 'Git worktrees across all your repos',
  async run(opts) {
    const audit = await auditWorktrees(opts);
    return auditToFindings(audit, opts);
  },
};
