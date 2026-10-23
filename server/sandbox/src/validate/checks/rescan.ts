import { loadWorkspace } from '../../config.js';
import type { ValidateCheck } from '../load-checks.js';
import { readRescanContext, recordRescanBaseline, rescan } from '../rescan.js';

export const check: ValidateCheck = {
  name: 'rescan',
  baseline: () => recordRescanBaseline(loadWorkspace().repoDir, readRescanContext()),
  run: (baseline) => rescan(loadWorkspace().repoDir, readRescanContext(), baseline),
};
