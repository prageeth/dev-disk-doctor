import { execFile } from 'node:child_process';

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run a program without a shell. Never throws. */
export function run(
  file: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; maxBuffer?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 30_000,
        maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
        encoding: 'utf8',
        env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
      },
      (err, stdout, stderr) => {
        if (!err) return resolve({ ok: true, code: 0, stdout, stderr, timedOut: false });
        const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
        resolve({
          ok: false,
          code: typeof e.code === 'number' ? e.code : null,
          stdout: stdout ?? '',
          stderr: stderr || e.message,
          timedOut: Boolean(e.killed),
        });
      },
    );
  });
}

export async function commandExists(file: string): Promise<boolean> {
  const r = await run(process.platform === 'win32' ? 'where' : 'which', [file], { timeoutMs: 5000 });
  return r.ok;
}
