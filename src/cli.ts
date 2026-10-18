#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyAction } from './core/fix.js';
import { buildOptions, scan } from './core/scan.js';
import type { ScanOptions } from './core/types.js';
import { expandHome } from './core/util.js';
import { renderScan, renderWorktrees } from './report/text.js';
import { auditWorktrees } from './worktrees/audit.js';

const HELP = `dev-disk-doctor: find out why your developer machine's disk is full

Usage
  dev-disk-doctor [scan]            Scan for space hogs (read-only)
  dev-disk-doctor worktrees         Audit git worktrees across all your repos (read-only)
  dev-disk-doctor fix <action-id>   Show what an action would do; add --yes to run it
  dev-disk-doctor mcp               Start the MCP server on stdio (for AI agents)

Options
  --json                 Machine-readable output (stable schema)
  --root <dir>           Workspace folder to search for projects and repos (repeatable;
                         default: ~/dev ~/code ~/src ~/projects ~/work ... whichever exist)
  --min-size <MB>        Ignore items smaller than this (default 100)
  --stale-days <n>       Days idle before a project or worktree counts as stale (default 30)
  --only <detector>      Run one detector (docker, android, xcode, pkgcaches, browsers,
                         models, projects, worktrees, system, biggest). Repeatable.
  --deep                 Also sweep your whole home folder for unknown space hogs (slow)
  --all                  Show every finding instead of the top 25
  --yes                  With "fix": actually run the action
  --no-color             Plain output
  -v, --version          Print the version

Nothing is deleted unless you run "fix <id> --yes". Actions marked CAREFUL are never run by the tool.`;

interface Parsed {
  command: string;
  positional: string[];
  json: boolean;
  roots: string[];
  minMb?: number;
  staleDays?: number;
  only: string[];
  deep: boolean;
  all: boolean;
  yes: boolean;
  color: boolean;
}

function parse(argv: string[]): Parsed {
  const p: Parsed = { command: 'scan', positional: [], json: false, roots: [], only: [], deep: false, all: false, yes: false, color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR };
  const args = [...argv];
  const need = (flag: string) => {
    const v = args.shift();
    if (v === undefined) throw new Error(`${flag} needs a value`);
    return v;
  };
  let first = true;
  while (args.length) {
    const a = args.shift()!;
    if (a === '--json') p.json = true;
    else if (a === '--root') p.roots.push(need(a));
    else if (a === '--min-size') p.minMb = Number(need(a));
    else if (a === '--stale-days') p.staleDays = Number(need(a));
    else if (a === '--only') p.only.push(need(a));
    else if (a === '--deep') p.deep = true;
    else if (a === '--all') p.all = true;
    else if (a === '--yes' || a === '-y') p.yes = true;
    else if (a === '--no-color') p.color = false;
    else if (a === '-h' || a === '--help' || a === 'help') p.command = 'help';
    else if (a === '-v' || a === '--version') p.command = 'version';
    else if (a.startsWith('-')) throw new Error(`Unknown option ${a}. Try --help.`);
    else if (first) p.command = a;
    else p.positional.push(a);
    first = false;
  }
  return p;
}

function version(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of ['../package.json', '../../package.json']) {
    try {
      return (JSON.parse(readFileSync(path.join(here, rel), 'utf8')) as { version: string }).version;
    } catch {
      /* try next */
    }
  }
  return 'unknown';
}

async function options(p: Parsed): Promise<ScanOptions> {
  const home = process.env.HOME ?? '';
  return buildOptions({
    roots: p.roots.map((r) => path.resolve(expandHome(r, home))),
    minBytes: p.minMb !== undefined ? p.minMb * 1024 * 1024 : undefined,
    staleDays: p.staleDays,
    deep: p.deep,
    only: p.only.length ? p.only : undefined,
  });
}

async function main(): Promise<void> {
  const p = parse(process.argv.slice(2));
  switch (p.command) {
    case 'help':
      console.log(HELP);
      return;
    case 'version':
      console.log(version());
      return;
    case 'mcp': {
      const { startMcp } = await import('./mcp.js');
      await startMcp();
      return;
    }
    case 'scan': {
      const opts = await options(p);
      if (!p.json) console.error('Scanning (read-only)… this can take a minute on a big disk.');
      const result = await scan(opts);
      console.log(p.json ? JSON.stringify(result, null, 2) : renderScan(result, { color: p.color }, { limit: p.all ? Infinity : 25 }));
      return;
    }
    case 'worktrees': {
      const opts = await options(p);
      if (!p.json) console.error('Auditing worktrees (read-only)…');
      const audit = await auditWorktrees(opts);
      console.log(p.json ? JSON.stringify(audit, null, 2) : renderWorktrees(audit, { color: p.color }, opts.home));
      return;
    }
    case 'fix': {
      const id = p.positional[0];
      if (!id) throw new Error('fix needs an action id, e.g. dev-disk-doctor fix "docker:build-cache#prune"');
      const opts = await options(p);
      const res = await applyAction(opts, id, p.yes);
      if (p.json) console.log(JSON.stringify(res, null, 2));
      else {
        console.log(res.message);
        if (res.command) console.log(`$ ${res.command}`);
        if (res.warning) console.log(`! ${res.warning}`);
        if (res.output) console.log(res.output);
        if (res.freedBytes !== undefined && !res.dryRun) console.log(`Free space changed by ${(res.freedBytes / 1024 ** 3).toFixed(2)} GB.`);
      }
      if (!res.ok) process.exitCode = 1;
      return;
    }
    default:
      throw new Error(`Unknown command "${p.command}". Try --help.`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
