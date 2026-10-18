import path from 'node:path';
import { run } from '../core/exec.js';
import { listDir } from '../core/util.js';
import type { Detector, Finding } from '../core/types.js';
import { execAction, pathFinding, pathFindings, type PathFindingSpec } from './helpers.js';

const REGEN = 'A cache: deleting it only means packages are downloaded again on the next install.';

async function pnpmFindings(opts: Parameters<Detector['run']>[0]): Promise<Finding[]> {
  const out: Finding[] = [];
  const active = await run('pnpm', ['store', 'path'], { timeoutMs: 15_000 });
  const activePath = active.ok ? active.stdout.trim() : undefined;
  const storeRoots = [path.join(opts.home, 'Library/pnpm/store'), path.join(opts.home, '.local/share/pnpm/store')];
  for (const root of storeRoots) {
    for (const v of await listDir(root)) {
      const dir = path.join(root, v);
      const isActive = activePath === dir;
      const f = await pathFinding(
        {
          detector: 'pkgcaches',
          key: `pnpm-store:${v}`,
          category: 'package-caches',
          title: `pnpm store ${v}${isActive ? ' (active for your installed pnpm)' : ''}`,
          path: dir,
          risk: 'safe',
          regenerable: true,
          why: isActive
            ? 'Content-addressable package store shared by every pnpm project. Pruning removes only packages no project links to anymore.'
            : 'Store from an older (or newer) pnpm major version that your installed pnpm does not use. Projects keep working: node_modules hard-link copies are independent of the store.',
          actions: (id, bytes) =>
            isActive
              ? [execAction(id, 'prune', 'Prune unreferenced packages', 'pnpm', ['store', 'prune'], 'safe')]
              : [
                  {
                    id: `${id}#remove`,
                    label: 'Delete this store',
                    display: `rm -rf '${dir}'`,
                    risk: 'safe',
                    kind: { type: 'remove-path', path: dir },
                    reclaimBytes: bytes,
                    warning: 'Next install with that pnpm version re-downloads packages.',
                  },
                ],
        },
        opts,
      );
      if (f) out.push(f);
    }
  }
  return out;
}

export const pkgcaches: Detector = {
  id: 'pkgcaches',
  title: 'Package manager and toolchain caches',
  async run(opts) {
    const h = opts.home;
    const mac = opts.platform === 'darwin';
    const lib = (p: string) => path.join(h, 'Library/Caches', p);
    const specs: PathFindingSpec[] = [
      {
        detector: 'pkgcaches',
        key: 'npm',
        category: 'package-caches',
        title: 'npm cache (~/.npm)',
        path: path.join(h, '.npm'),
        risk: 'safe',
        regenerable: true,
        why: 'Downloaded tarballs plus the npx cache. Only speeds up installs.',
        actions: (id, bytes) => [execAction(id, 'clean', 'Clear the npm cache', 'npm', ['cache', 'clean', '--force'], 'safe', { bytes })],
      },
      { detector: 'pkgcaches', key: 'pnpm-meta', category: 'package-caches', title: 'pnpm metadata cache', path: lib('pnpm'), risk: 'safe', regenerable: true, why: REGEN },
      { detector: 'pkgcaches', key: 'yarn', category: 'package-caches', title: 'Yarn cache', path: lib('Yarn'), risk: 'safe', regenerable: true, why: REGEN },
      { detector: 'pkgcaches', key: 'yarn-berry', category: 'package-caches', title: 'Yarn Berry global cache', path: path.join(h, '.yarn/berry/cache'), risk: 'safe', regenerable: true, why: REGEN },
      { detector: 'pkgcaches', key: 'bun', category: 'package-caches', title: 'Bun install cache', path: path.join(h, '.bun/install/cache'), risk: 'safe', regenerable: true, why: REGEN },
      { detector: 'pkgcaches', key: 'pip', category: 'package-caches', title: 'pip cache', path: mac ? lib('pip') : path.join(h, '.cache/pip'), risk: 'safe', regenerable: true, why: REGEN },
      { detector: 'pkgcaches', key: 'uv', category: 'package-caches', title: 'uv cache', path: path.join(h, '.cache/uv'), risk: 'safe', regenerable: true, why: REGEN },
      { detector: 'pkgcaches', key: 'homebrew', category: 'package-caches', title: 'Homebrew downloads cache', path: mac ? lib('Homebrew') : path.join(h, '.cache/Homebrew'), risk: 'safe', regenerable: true, why: 'Old bottles and downloads Homebrew keeps after installing.', actions: (id, bytes) => [execAction(id, 'cleanup', 'Run brew cleanup', 'brew', ['cleanup', '--prune=all', '-s'], 'safe', { bytes })] },
      { detector: 'pkgcaches', key: 'cargo-registry', category: 'package-caches', title: 'Cargo registry cache', path: path.join(h, '.cargo/registry'), risk: 'safe', regenerable: true, why: REGEN },
      { detector: 'pkgcaches', key: 'cargo-git', category: 'package-caches', title: 'Cargo git checkouts', path: path.join(h, '.cargo/git'), risk: 'safe', regenerable: true, why: REGEN },
      { detector: 'pkgcaches', key: 'gradle-caches', category: 'package-caches', title: 'Gradle caches', path: path.join(h, '.gradle/caches'), risk: 'safe', regenerable: true, why: 'Dependency and build caches. The next Gradle build re-downloads what it needs, which can take a while.', warning: 'Stop Gradle daemons first (`./gradlew --stop`).' },
      { detector: 'pkgcaches', key: 'gradle-wrapper', category: 'package-caches', title: 'Gradle wrapper distributions', path: path.join(h, '.gradle/wrapper/dists'), risk: 'safe', regenerable: true, why: 'One Gradle install per version your projects asked for. Re-downloaded on demand.' },
      { detector: 'pkgcaches', key: 'maven', category: 'package-caches', title: 'Maven local repository', path: path.join(h, '.m2/repository'), risk: 'review', regenerable: true, why: 'Maven artifacts, including any you installed locally from your own builds, which cannot be downloaded again.' },
      { detector: 'pkgcaches', key: 'cocoapods', category: 'package-caches', title: 'CocoaPods cache', path: lib('CocoaPods'), risk: 'safe', regenerable: true, why: REGEN },
      { detector: 'pkgcaches', key: 'go-build', category: 'package-caches', title: 'Go build cache', path: mac ? lib('go-build') : path.join(h, '.cache/go-build'), risk: 'safe', regenerable: true, why: 'Compiled package cache. Rebuilt on the next build.' },
      { detector: 'pkgcaches', key: 'jetbrains', category: 'package-caches', title: 'JetBrains IDE caches', path: lib('JetBrains'), risk: 'safe', regenerable: true, why: 'Indexes and caches for IntelliJ, WebStorm, Android Studio and friends. Rebuilt when you reopen projects.', warning: 'Quit the IDE first.' },
      { detector: 'pkgcaches', key: 'chrome-cache', category: 'package-caches', title: 'Google Chrome cache', path: lib('Google'), risk: 'safe', regenerable: true, why: 'Browser cache. Chrome refills it as you browse.', warning: 'Quit Chrome first.' },
    ];
    const conda = ['miniconda3', 'anaconda3', 'miniforge3', 'mambaforge'].map((d) => path.join(h, d));
    for (const base of conda) {
      specs.push({
        detector: 'pkgcaches',
        key: `conda-pkgs:${path.basename(base)}`,
        category: 'package-caches',
        title: `Conda package cache (${path.basename(base)})`,
        path: path.join(base, 'pkgs'),
        risk: 'safe',
        regenerable: true,
        why: 'Downloaded conda packages and extracted copies. `conda clean` removes the ones no environment uses.',
        actions: (id, bytes) => [execAction(id, 'clean', 'Run conda clean --all', path.join(base, 'bin/conda'), ['clean', '--all', '--yes'], 'safe', { bytes })],
      });
    }
    const found = await pathFindings(specs, opts);
    return [...found, ...(await pnpmFindings(opts))];
  },
};
