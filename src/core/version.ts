import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The published package version, read from package.json next to the compiled files. */
export function version(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of ['../../package.json', '../../../package.json']) {
    try {
      return (JSON.parse(readFileSync(path.join(here, rel), 'utf8')) as { version: string }).version;
    } catch {
      /* try next */
    }
  }
  return 'unknown';
}
