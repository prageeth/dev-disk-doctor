import path from 'node:path';
import { sizeOf } from '../core/size.js';
import { isDir, listDir, readText } from '../core/util.js';
import type { Detector, Finding } from '../core/types.js';
import { pathFinding, removeAction } from './helpers.js';

function sdkRoots(home: string): string[] {
  const roots = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME].filter((v): v is string => Boolean(v));
  roots.push(path.join(home, 'Library/Android/sdk'), path.join(home, 'Android/Sdk'));
  return [...new Set(roots)];
}

/** Image folders referenced by AVDs, as `android-36/google_apis_playstore/arm64-v8a`. */
async function imagesInUse(home: string): Promise<Set<string>> {
  const used = new Set<string>();
  const avdDir = process.env.ANDROID_AVD_HOME ?? path.join(home, '.android/avd');
  for (const entry of await listDir(avdDir)) {
    if (!entry.endsWith('.avd')) continue;
    const cfg = await readText(path.join(avdDir, entry, 'config.ini'));
    const m = cfg && /^image\.sysdir\.1\s*=\s*(.+)$/m.exec(cfg);
    if (m) used.add(m[1].trim().replace(/^system-images\//, '').replace(/\/+$/, ''));
  }
  return used;
}

export const android: Detector = {
  id: 'android',
  title: 'Android SDK and emulators',
  async run(opts) {
    const findings: Finding[] = [];
    const used = await imagesInUse(opts.home);

    for (const sdk of sdkRoots(opts.home)) {
      const imagesRoot = path.join(sdk, 'system-images');
      if (!(await isDir(imagesRoot))) continue;
      for (const api of await listDir(imagesRoot)) {
        for (const tag of await listDir(path.join(imagesRoot, api))) {
          for (const abi of await listDir(path.join(imagesRoot, api, tag))) {
            const dir = path.join(imagesRoot, api, tag, abi);
            if (!(await isDir(dir))) continue;
            const key = `${api}/${tag}/${abi}`;
            const bytes = await sizeOf(dir, opts.detectorTimeoutMs);
            if (bytes === undefined || bytes < opts.minBytes) continue;
            const id = `android:image:${key}`;
            const inUse = used.has(key);
            findings.push({
              id,
              detector: 'android',
              category: 'mobile',
              title: `Android emulator image ${key}${inUse ? ' (used by an AVD)' : ''}`,
              path: dir,
              bytes,
              risk: inUse ? 'danger' : 'review',
              regenerable: true,
              why: inUse
                ? 'An existing virtual device boots from this image. Removing it breaks that emulator.'
                : 'System image no virtual device uses. Re-downloadable from the SDK Manager.',
              actions: inUse ? [] : [removeAction(id, dir, 'review', bytes, 'You will need to re-download it if you create an emulator for this API level later.')],
              meta: { inUse },
            });
          }
        }
      }
      const extras = await Promise.all([
        pathFinding(
          {
            detector: 'android',
            key: 'ndk',
            category: 'mobile',
            title: 'Android NDK versions',
            path: path.join(sdk, 'ndk'),
            risk: 'review',
            regenerable: true,
            why: 'Native toolchains. Several versions pile up as projects pin different ones; keep the ones your projects use.',
            removable: false,
          },
          opts,
        ),
      ]);
      findings.push(...extras.filter((f): f is Finding => f !== undefined));
    }

    const avds = await pathFinding(
      {
        detector: 'android',
        key: 'avd',
        category: 'mobile',
        title: 'Android virtual devices (AVD data)',
        path: process.env.ANDROID_AVD_HOME ?? path.join(opts.home, '.android/avd'),
        risk: 'review',
        regenerable: false,
        why: 'Disk images and snapshots for your emulators, including any app data installed on them. Wipe a device in Android Studio rather than deleting the folder.',
        removable: false,
      },
      opts,
    );
    if (avds) findings.push(avds);
    return findings;
  },
};
