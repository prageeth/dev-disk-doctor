import { promises as fs } from 'node:fs';
import path from 'node:path';
import { sizeOf } from '../core/size.js';
import { daysAgo, pathExists } from '../core/util.js';
import type { Detector, Finding, ScanOptions } from '../core/types.js';
import { removeAction } from './helpers.js';

interface Artifact {
  dir: string;
  kind: string;
  why: string;
  /** How to get it back. */
  rebuild: string;
}

const SKIP = new Set(['.git', 'Library', '.Trash', '.cache', 'vendor', '__pycache__', '.gradle']);
/** Hidden folders worth entering because AI tools park worktrees there. */
const HIDDEN_OK = new Set(['.claude', '.codex', '.cursor', '.worktrees', '.conductor']);
const MAX_DEPTH = 7;
const MAX_DIRS = 400_000;

async function artifactKind(dir: string, name: string): Promise<{ kind: string; why: string; rebuild: string } | undefined> {
  const sib = (f: string) => pathExists(path.join(dir, f));
  switch (name) {
    case 'node_modules':
      return { kind: 'node_modules', why: 'Installed JavaScript dependencies.', rebuild: 'npm/pnpm/yarn install' };
    case '.next':
    case '.nuxt':
    case '.svelte-kit':
    case '.turbo':
    case '.expo':
      if (await sib('package.json')) return { kind: name, why: 'Framework build output and cache.', rebuild: 'the next dev/build run' };
      return undefined;
    case 'target':
      if (await sib('Cargo.toml')) return { kind: 'Rust target', why: 'Cargo build output.', rebuild: 'cargo build' };
      return undefined;
    case 'Pods':
      if (await sib('Podfile')) return { kind: 'CocoaPods Pods', why: 'Installed iOS dependencies.', rebuild: 'pod install' };
      return undefined;
    case '.venv':
    case 'venv':
      if (await pathExists(path.join(dir, name, 'pyvenv.cfg'))) return { kind: 'Python venv', why: 'A virtual environment.', rebuild: 'recreate the venv and reinstall requirements' };
      return undefined;
    default:
      return undefined;
  }
}

async function newestMtime(paths: string[]): Promise<number | undefined> {
  let best: number | undefined;
  for (const p of paths) {
    try {
      const st = await fs.stat(p);
      if (best === undefined || st.mtimeMs > best) best = st.mtimeMs;
    } catch {
      /* missing */
    }
  }
  return best;
}

async function findArtifacts(roots: string[]): Promise<Artifact[]> {
  const out: Artifact[] = [];
  let visited = 0;
  const seen = new Set<string>();

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || visited++ > MAX_DIRS) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      const a = await artifactKind(dir, e.name);
      if (a) {
        if (!seen.has(full)) {
          seen.add(full);
          out.push({ dir: full, ...a });
        }
        continue; // never descend into an artifact
      }
      if (SKIP.has(e.name)) continue;
      if (e.name.startsWith('.') && !HIDDEN_OK.has(e.name)) continue;
      await walk(full, depth + 1);
    }
  }
  await Promise.all(roots.map((r) => walk(r, 0)));
  return out;
}

export const projects: Detector = {
  id: 'projects',
  title: 'Dependencies and build output in your projects',
  async run(opts: ScanOptions) {
    const artifacts = await findArtifacts(opts.roots);
    const findings: Finding[] = [];
    const now = Date.now();
    await Promise.all(
      artifacts.map(async (a) => {
        const bytes = await sizeOf(a.dir, opts.detectorTimeoutMs);
        if (bytes === undefined || bytes < opts.minBytes) return;
        const project = path.dirname(a.dir);
        const activity =
          (await newestMtime([
            path.join(project, 'package.json'),
            path.join(project, 'package-lock.json'),
            path.join(project, 'pnpm-lock.yaml'),
            path.join(project, 'yarn.lock'),
            path.join(project, 'Cargo.lock'),
            path.join(project, 'Podfile.lock'),
            path.join(project, '.git/HEAD'),
            path.join(project, '.git/index'),
          ])) ?? (await newestMtime([a.dir]));
        const idle = activity === undefined ? undefined : daysAgo(activity, now);
        const stale = idle !== undefined && idle >= opts.staleDays;
        const id = `projects:${a.dir}`;
        const risk = stale ? 'safe' : 'review';
        findings.push({
          id,
          detector: 'projects',
          category: 'projects',
          title: `${a.kind} in ${project.replace(opts.home, '~')}${idle !== undefined ? ` (idle ${idle}d)` : ''}`,
          path: a.dir,
          bytes,
          risk,
          regenerable: true,
          why: `${a.why} Rebuilt with ${a.rebuild}.${stale ? ' The project has not been touched recently.' : ' The project was active recently, so you will likely need this soon.'}`,
          actions: [removeAction(id, a.dir, risk, bytes, stale ? undefined : 'Active project: the next run will need to reinstall or rebuild.')],
          meta: { project, idleDays: idle, stale },
        });
      }),
    );
    return findings;
  },
};
