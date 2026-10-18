import path from 'node:path';
import type { Detector, Finding } from '../core/types.js';
import { execAction, manualAction, pathFindings } from './helpers.js';
import { sizeOf } from '../core/size.js';

export const xcode: Detector = {
  id: 'xcode',
  title: 'Xcode and iOS Simulator',
  async run(opts) {
    if (opts.platform !== 'darwin') return [];
    const dev = path.join(opts.home, 'Library/Developer');
    const findings: Finding[] = await pathFindings(
      [
        {
          detector: 'xcode',
          key: 'derived-data',
          category: 'mobile',
          title: 'Xcode DerivedData',
          path: path.join(dev, 'Xcode/DerivedData'),
          risk: 'safe',
          regenerable: true,
          why: 'Build products and indexes. Xcode rebuilds them; the next build is just slower.',
          warning: 'Quit Xcode first.',
        },
        {
          detector: 'xcode',
          key: 'device-support',
          category: 'mobile',
          title: 'Xcode iOS DeviceSupport',
          path: path.join(dev, 'Xcode/iOS DeviceSupport'),
          risk: 'safe',
          regenerable: true,
          why: 'Debug symbols copied from every iPhone or iPad you ever plugged in, one folder per iOS version. Recreated the next time that device connects.',
        },
        {
          detector: 'xcode',
          key: 'archives',
          category: 'mobile',
          title: 'Xcode Archives',
          path: path.join(dev, 'Xcode/Archives'),
          risk: 'review',
          regenerable: false,
          why: 'Past app builds, including the dSYMs needed to symbolicate crash reports for released versions.',
          removable: false,
        },
        {
          detector: 'xcode',
          key: 'simulator-caches',
          category: 'mobile',
          title: 'CoreSimulator caches',
          path: path.join(dev, 'CoreSimulator/Caches'),
          risk: 'safe',
          regenerable: true,
          why: 'Simulator dyld and runtime caches. Rebuilt on the next simulator boot.',
        },
      ],
      opts,
    );

    const sims = path.join(dev, 'CoreSimulator/Devices');
    const simBytes = await sizeOf(sims, opts.detectorTimeoutMs);
    if (simBytes !== undefined && simBytes >= opts.minBytes) {
      const id = 'xcode:simulators';
      findings.push({
        id,
        detector: 'xcode',
        category: 'mobile',
        title: 'iOS Simulator devices and their data',
        path: sims,
        bytes: simBytes,
        risk: 'review',
        regenerable: false,
        why: 'Every simulator keeps its own installed apps and data. Simulators for runtimes you no longer have are dead weight.',
        actions: [
          execAction(id, 'delete-unavailable', 'Delete simulators whose runtime is gone', 'xcrun', ['simctl', 'delete', 'unavailable'], 'safe'),
          manualAction(id, 'list', 'See which simulators exist', 'xcrun simctl list devices', 'safe'),
        ],
      });
    }
    return findings;
  },
};
