import path from 'node:path';
import type { Detector } from '../core/types.js';
import { pathFindings, type PathFindingSpec } from './helpers.js';

export const browsers: Detector = {
  id: 'browsers',
  title: 'Test browsers (Playwright, Puppeteer, Cypress)',
  async run(opts) {
    const h = opts.home;
    const mac = opts.platform === 'darwin';
    const why = 'Browser binaries downloaded for automated testing, one set per tool version, so old versions pile up. Re-downloaded by the tool when needed (e.g. `npx playwright install`).';
    const specs: PathFindingSpec[] = [
      { detector: 'browsers', key: 'playwright', category: 'browsers', title: 'Playwright browsers', path: mac ? path.join(h, 'Library/Caches/ms-playwright') : path.join(h, '.cache/ms-playwright'), risk: 'safe', regenerable: true, why },
      { detector: 'browsers', key: 'puppeteer', category: 'browsers', title: 'Puppeteer browsers', path: path.join(h, '.cache/puppeteer'), risk: 'safe', regenerable: true, why },
      { detector: 'browsers', key: 'cypress', category: 'browsers', title: 'Cypress binaries', path: mac ? path.join(h, 'Library/Caches/Cypress') : path.join(h, '.cache/Cypress'), risk: 'safe', regenerable: true, why },
    ];
    return pathFindings(specs, opts);
  },
};

export const models: Detector = {
  id: 'models',
  title: 'AI and ML model caches',
  async run(opts) {
    const h = opts.home;
    const why = (what: string) =>
      `${what} Model files are large and can take hours to download again, so only delete what you no longer use.`;
    const specs: PathFindingSpec[] = [
      { detector: 'models', key: 'huggingface', category: 'ai-models', title: 'Hugging Face model cache', path: path.join(h, '.cache/huggingface'), risk: 'review', regenerable: true, why: why('Models and datasets downloaded by transformers, diffusers and similar libraries.') },
      { detector: 'models', key: 'ollama', category: 'ai-models', title: 'Ollama models', path: path.join(h, '.ollama/models'), risk: 'review', regenerable: true, why: why('Local LLMs pulled with `ollama pull`.'), warning: 'Prefer `ollama rm <model>` to remove individual models.' },
      { detector: 'models', key: 'lmstudio', category: 'ai-models', title: 'LM Studio models', path: path.join(h, '.lmstudio/models'), risk: 'review', regenerable: true, why: why('Models downloaded through LM Studio.') },
      { detector: 'models', key: 'torch', category: 'ai-models', title: 'PyTorch hub cache', path: path.join(h, '.cache/torch'), risk: 'review', regenerable: true, why: why('Pretrained weights fetched by torch and torchvision.') },
      { detector: 'models', key: 'diffusionbee', category: 'ai-models', title: 'DiffusionBee model assets', path: path.join(h, '.diffusionbee/downloaded_assets'), risk: 'review', regenerable: true, why: why('Stable Diffusion weights downloaded by the DiffusionBee app.') },
    ];
    return pathFindings(specs, opts);
  },
};
