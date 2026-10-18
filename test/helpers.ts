import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ScanOptions } from '../src/core/types.js';

export function tmp(prefix = 'ddd-'): string {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
}

export function makeRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

export function opts(home: string, over: Partial<ScanOptions> = {}): ScanOptions {
  return {
    home,
    platform: process.platform,
    roots: [home],
    minBytes: 0,
    staleDays: 14,
    deep: false,
    detectorTimeoutMs: 30_000,
    ...over,
  };
}

export function write(p: string, content = 'x'.repeat(2048)): void {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}
