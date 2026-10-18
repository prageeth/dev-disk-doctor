import path from 'node:path';
import { run } from '../core/exec.js';
import { sizeOf } from '../core/size.js';
import { parseDockerSize, pathExists } from '../core/util.js';
import type { Detector, Finding } from '../core/types.js';
import { execAction, manualAction } from './helpers.js';

interface DfRow {
  Type: string;
  TotalCount: string;
  Active: string;
  Size: string;
  Reclaimable: string;
}

function parseDf(stdout: string): DfRow[] {
  const rows: DfRow[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try {
      rows.push(JSON.parse(line) as DfRow);
    } catch {
      /* ignore partial lines */
    }
  }
  return rows;
}

export const docker: Detector = {
  id: 'docker',
  title: 'Docker',
  async run(opts) {
    const findings: Finding[] = [];
    const candidates = [
      path.join(opts.home, 'Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw'),
      path.join(opts.home, 'Library/Containers/com.docker.docker/Data/vms/0/data/Docker.qcow2'),
      path.join(opts.home, '.docker/desktop/vms/0/data/Docker.raw'),
    ];
    let diskImage: string | undefined;
    let diskBytes = 0;
    for (const c of candidates) {
      if (!(await pathExists(c))) continue;
      const b = (await sizeOf(c, opts.detectorTimeoutMs)) ?? 0;
      if (b > diskBytes) {
        diskBytes = b;
        diskImage = c;
      }
    }

    const df = await run('docker', ['system', 'df', '--format', '{{json .}}'], { timeoutMs: 20_000 });
    const rows = df.ok ? parseDf(df.stdout) : [];

    if (diskImage && diskBytes >= opts.minBytes) {
      const id = 'docker:disk-image';
      findings.push({
        id,
        detector: 'docker',
        category: 'containers',
        title: 'Docker Desktop disk image',
        path: diskImage,
        bytes: diskBytes,
        risk: 'danger',
        regenerable: false,
        meta: { envelope: true },
        why: rows.length
          ? 'All images, containers, volumes and build cache live inside this one file. It grows but never shrinks on its own, so pruning inside Docker may not give the space back until Docker Desktop compacts it.'
          : 'All images, containers, volumes and build cache live inside this one file. Docker is not running, so the contents could not be inspected: start Docker Desktop and scan again.',
        actions: [
          manualAction(
            id,
            'shrink',
            'Prune inside Docker first, then compact the image',
            'Docker Desktop → Settings → Resources → Disk image size (or Troubleshoot → Clean / Purge data)',
            'danger',
            'Never delete this file by hand and "Clean / Purge data" removes every image, container and volume, including databases.',
          ),
        ],
      });
    }

    for (const row of rows) {
      const reclaim = parseDockerSize(row.Reclaimable.split(' ')[0] ?? '');
      if (reclaim < opts.minBytes) continue;
      if (row.Type === 'Images') {
        const id = 'docker:images';
        findings.push({
          id,
          detector: 'docker',
          category: 'containers',
          title: `Unused Docker images (${row.TotalCount} total, ${row.Active} in use)`,
          bytes: reclaim,
          risk: 'review',
          regenerable: true,
          why: 'Images no container uses. Anything pulled from a registry can be pulled again; images you built locally and never pushed must be rebuilt.',
          actions: [
            execAction(id, 'prune', 'Remove all images not used by any container', 'docker', ['image', 'prune', '-a', '-f'], 'review', {
              bytes: reclaim,
              warning: 'Images that exist only on this machine (local builds, unpushed tags) are lost.',
            }),
          ],
        });
      } else if (row.Type === 'Build Cache') {
        const id = 'docker:build-cache';
        findings.push({
          id,
          detector: 'docker',
          category: 'containers',
          title: 'Docker build cache',
          bytes: reclaim,
          risk: 'safe',
          regenerable: true,
          why: 'Layers cached from previous builds. Deleting them only makes the next build slower.',
          actions: [
            execAction(id, 'prune', 'Clear the build cache', 'docker', ['builder', 'prune', '-a', '-f'], 'safe', { bytes: reclaim }),
          ],
        });
      } else if (row.Type === 'Containers') {
        const id = 'docker:containers';
        findings.push({
          id,
          detector: 'docker',
          category: 'containers',
          title: 'Stopped Docker containers',
          bytes: reclaim,
          risk: 'review',
          regenerable: false,
          why: 'Stopped containers keep their writable layer. Data written inside a container (not in a volume) is lost when it is removed.',
          actions: [
            execAction(id, 'prune', 'Remove all stopped containers', 'docker', ['container', 'prune', '-f'], 'review', {
              bytes: reclaim,
              warning: 'Check that nothing you care about lives in a stopped container.',
            }),
          ],
        });
      } else if (row.Type === 'Local Volumes') {
        const id = 'docker:volumes';
        findings.push({
          id,
          detector: 'docker',
          category: 'containers',
          title: 'Unused Docker volumes',
          bytes: reclaim,
          risk: 'danger',
          regenerable: false,
          why: 'Volumes hold persistent data such as local databases. "Unused" means no container is attached right now, not that the data is disposable.',
          actions: [
            manualAction(
              id,
              'prune',
              'Review volumes, then prune',
              'docker volume ls   # inspect first, then: docker volume rm <name>',
              'danger',
              'Deleted volumes cannot be recovered. The tool will not run this for you.',
            ),
          ],
        });
      }
    }
    return findings;
  },
};
