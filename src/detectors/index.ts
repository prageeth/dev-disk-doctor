import type { Detector } from '../core/types.js';
import { android } from './android.js';
import { biggest } from './biggest.js';
import { browsers, models } from './browsers-models.js';
import { docker } from './docker.js';
import { pkgcaches } from './pkgcaches.js';
import { projects } from './projects.js';
import { system } from './system.js';
import { xcode } from './xcode.js';
import { worktrees } from '../worktrees/detector.js';

/** `biggest` must stay last: it subtracts what the others already explain. */
export const detectors: Detector[] = [docker, android, xcode, pkgcaches, browsers, models, projects, worktrees, system, biggest];
