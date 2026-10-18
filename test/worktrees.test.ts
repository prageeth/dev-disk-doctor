import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { auditWorktrees, classify, parseWorktreeList } from '../src/worktrees/audit.js';
import { auditToFindings } from '../src/worktrees/detector.js';
import { git, makeRepo, opts, tmp, write } from './helpers.js';

describe('parseWorktreeList', () => {
  it('parses branches, detached, locked and prunable entries', () => {
    const out = [
      'worktree /r',
      'HEAD aaa',
      'branch refs/heads/main',
      '',
      'worktree /r/wt1',
      'HEAD bbb',
      'detached',
      'locked in use',
      '',
      'worktree /r/gone',
      'HEAD ccc',
      'branch refs/heads/x',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n');
    const w = parseWorktreeList(out);
    assert.equal(w.length, 3);
    assert.equal(w[0].branch, 'main');
    assert.equal(w[1].detached, true);
    assert.equal(w[1].locked, true);
    assert.equal(w[1].lockReason, 'in use');
    assert.equal(w[2].prunable, true);
  });
});

describe('classify', () => {
  const base = { locked: false, dirty: false, unpushed: 0, merged: true, idleDays: 100 };
  it('flags clean, merged, idle worktrees as stale', () => assert.equal(classify(base, 14).status, 'stale'));
  it('keeps recently used worktrees active', () => assert.equal(classify({ ...base, idleDays: 2 }, 14).status, 'active'));
  it('never offers dirty worktrees', () => assert.equal(classify({ ...base, dirty: true }, 14).status, 'at-risk'));
  it('never offers worktrees with unmerged, unpushed commits', () =>
    assert.equal(classify({ ...base, unpushed: 3, merged: false }, 14).status, 'at-risk'));
  it('treats unknown git state as at-risk', () => assert.equal(classify({ ...base, dirty: undefined }, 14).status, 'at-risk'));
  it('respects locks', () => assert.equal(classify({ ...base, locked: true }, 14).status, 'locked'));
});

describe('auditWorktrees on real repos', () => {
  const home = tmp();
  const repo = makeRepo(path.join(home, 'proj'));
  const wt = (name: string) => path.join(repo, '.claude/worktrees', name);

  // stale: clean, branch at the same commit as main (so merged)
  git(repo, 'worktree', 'add', '-q', '-b', 'feat/stale', wt('stale'));
  // dirty
  git(repo, 'worktree', 'add', '-q', '-b', 'feat/dirty', wt('dirty'));
  write(path.join(wt('dirty'), 'notes.txt'), 'unsaved');
  // unmerged commit, no remote
  git(repo, 'worktree', 'add', '-q', '-b', 'feat/ahead', wt('ahead'));
  write(path.join(wt('ahead'), 'new.txt'), 'work');
  git(wt('ahead'), 'add', '-A');
  git(wt('ahead'), 'commit', '-q', '-m', 'wip');
  // folder deleted behind git's back
  git(repo, 'worktree', 'add', '-q', '-b', 'feat/gone', wt('gone'));
  rmSync(wt('gone'), { recursive: true, force: true });
  // orphan: folder survives, repo forgets it
  git(repo, 'worktree', 'add', '-q', '-b', 'feat/orphan', wt('orphan'));
  rmSync(path.join(repo, '.git/worktrees/orphan'), { recursive: true, force: true });

  it('classifies each case', async () => {
    const audit = await auditWorktrees(opts(home, { staleDays: 0 }));
    const r = audit.repos.find((x) => x.repo === repo);
    assert.ok(r, 'repo discovered');
    const by = (name: string) => r!.worktrees.find((w) => w.path.endsWith(`/${name}`));
    assert.equal(by('stale')?.status, 'stale');
    assert.equal(by('stale')?.toolOwned, 'claude');
    assert.equal(by('dirty')?.status, 'at-risk');
    assert.equal(by('ahead')?.status, 'at-risk');
    assert.equal(by('gone')?.status, 'prunable');
    assert.equal(audit.orphans.length, 1);
    assert.ok(audit.orphans[0].path.endsWith('/orphan'));
    assert.equal(audit.totals.linkedWorktrees, 4);
  });

  it('keeps everything active when nothing is old', async () => {
    const audit = await auditWorktrees(opts(home, { staleDays: 100_000 }));
    assert.equal(audit.totals.byStatus.stale, 0);
    assert.equal(audit.totals.byStatus.active, 1);
  });

  it('only offers a remove action for stale worktrees, never for at-risk ones', async () => {
    const audit = await auditWorktrees(opts(home, { staleDays: 0 }));
    const findings = auditToFindings(audit, { home });
    const stale = findings.find((f) => f.id.endsWith('/stale'));
    const dirty = findings.find((f) => f.id.endsWith('/dirty'));
    const ahead = findings.find((f) => f.id.endsWith('/ahead'));
    assert.equal(stale?.actions[0].kind.type, 'exec');
    assert.equal(stale?.risk, 'review');
    for (const f of [dirty, ahead]) {
      assert.equal(f?.risk, 'danger');
      assert.ok(f?.actions.every((a) => a.kind.type === 'manual'));
    }
    assert.ok(findings.some((f) => f.id.startsWith('worktrees:prune:')));
    assert.ok(findings.some((f) => f.id.startsWith('worktrees:orphan:')));
  });
});
