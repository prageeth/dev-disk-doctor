import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { defaultRoots } from '../src/core/roots.js';
import { tmp, write } from './helpers.js';

const mk = (...p: string[]) => mkdirSync(path.join(...p), { recursive: true });

describe('defaultRoots', () => {
  it('finds a company-named folder that contains repos, plus well-known names', async () => {
    const home = tmp();
    mk(home, 'dev'); // empty but a known name
    mk(home, 'acme/backend/.git');
    mk(home, 'globex/team/service/.git');
    write(path.join(home, 'weekend/app/package.json'), '{}');
    mk(home, 'Postman'); // no projects inside
    mk(home, 'Documents/GitHub/thing/.git'); // never searched by default
    mk(home, 'Desktop/x/.git');
    mk(home, 'Library/Foo/.git');
    mk(home, 'Dropbox/stuff/.git');
    mk(home, '.hidden/repo/.git');

    const roots = (await defaultRoots(home, {})).map((r) => path.basename(r));
    assert.deepEqual(roots, ['acme', 'dev', 'globex', 'weekend']);
  });

  it('DEV_DISK_DOCTOR_ROOTS replaces auto-discovery and supports ~', async () => {
    const home = tmp();
    mk(home, 'acme/api/.git');
    mk(home, 'elsewhere');
    const roots = await defaultRoots(home, { DEV_DISK_DOCTOR_ROOTS: `~/elsewhere:${home}/missing` });
    assert.deepEqual(roots, [path.join(home, 'elsewhere')]);
  });
});
