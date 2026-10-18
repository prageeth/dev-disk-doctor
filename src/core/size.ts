import { run } from './exec.js';
import { pathExists } from './util.js';

const MAX_PARALLEL = 4;
let active = 0;
const waiting: (() => void)[] = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/**
 * Allocated size in bytes (what the disk actually spends, so sparse files such as
 * Docker.raw report their real footprint). Returns undefined if missing or too slow.
 */
export async function sizeOf(p: string, timeoutMs = 120_000): Promise<number | undefined> {
  if (!(await pathExists(p))) return undefined;
  return slot(async () => {
    // -k: 1024-byte blocks, -s: summary, -x: stay on one filesystem. Exit code can be
    // non-zero on unreadable subfolders while stdout is still the right total.
    const r = await run('du', ['-skx', p], { timeoutMs });
    if (r.timedOut) return undefined;
    const kb = Number(r.stdout.split(/\s/, 1)[0]);
    return Number.isFinite(kb) ? kb * 1024 : undefined;
  });
}
