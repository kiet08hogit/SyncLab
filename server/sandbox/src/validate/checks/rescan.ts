import { loadMigration, loadWorkspace } from '../../config.js';
import type { ValidateCheck } from '../load-checks.js';
import { readRescanContext, recordRescanBaseline, rescan } from '../rescan.js';

function impactedFiles(): string[] {
  const migration = loadMigration();
  return migration.kind === 'api_change' ? migration.files : [];
}

export const check: ValidateCheck = {
  name: 'rescan',
  baseline: () => recordRescanBaseline(loadWorkspace().repoDir, readRescanContext(), impactedFiles()),
  run: (baseline) => rescan(loadWorkspace().repoDir, readRescanContext(), baseline),
};
