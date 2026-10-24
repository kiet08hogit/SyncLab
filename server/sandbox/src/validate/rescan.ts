import { scanApiUsage, type ApiUsage } from '../analysis/api-usage.js';
import { readSourceFiles } from '../phases/scan.js';
import { ImpactConfidence, matchUsage, type MatchChange } from './match.js';

/** A confirmed change, as server/api/src/worker/sandbox/validation-context/rescan.ts sends it. */
export interface RescanChange extends MatchChange {
  provider: string;
}

/**
 * `target` is the change being migrated, null for a dependency migration.
 * `removed` holds every other confirmed retirement or removal.
 */
export interface RescanContext {
  target: RescanChange | null;
  removed: RescanChange[];
}

/** Recorded on the tree as prepare cloned it, before any repository code ran. */
export interface RescanBaseline {
  /**
   * The source files the clone had. Install and test scripts can generate
   * more, such as build output, which a migration neither wrote nor can fix.
   */
  files: string[];
  /** Matches per change, file and confidence, only of the kinds rescan reads. */
  hits: Record<string, number>;
  unparsed: string[];
}

interface Hit {
  change: RescanChange;
  target: boolean;
  file: string;
  line: number;
  confidence: ImpactConfidence;
}

function isChange(value: unknown): value is RescanChange {
  const change = value as Record<string, unknown> | null;
  const optional = (field: unknown) => field === null || typeof field === 'string';
  return (
    typeof change === 'object' &&
    change !== null &&
    typeof change.provider === 'string' &&
    typeof change.kind === 'string' &&
    optional(change.operation) &&
    optional(change.field)
  );
}

/** Undefined when the worker sent nothing for the re-scan to compare against. */
export function readRescanContext(json = process.env.VALIDATE_CONTEXT): RescanContext | undefined {
  const rescan = (JSON.parse(json || '{}') as { rescan?: unknown }).rescan as
    | { target?: unknown; removed?: unknown }
    | undefined;
  if (!rescan) return undefined;

  const target = rescan.target ?? null;
  const removed = rescan.removed ?? [];
  if ((target !== null && !isChange(target)) || !Array.isArray(removed) || !removed.every(isChange)) {
    throw new Error('VALIDATE_CONTEXT has a malformed rescan entry');
  }
  if (!target && removed.length === 0) return undefined;
  return { target, removed };
}

function findHits(usages: ApiUsage[], context: RescanContext): Hit[] {
  const changes = [
    ...(context.target ? [{ change: context.target, target: true }] : []),
    ...context.removed.map((change) => ({ change, target: false })),
  ];
  const hits: Hit[] = [];
  for (const usage of usages) {
    for (const { change, target } of changes) {
      if (change.provider !== usage.provider) continue;
      const confidence = matchUsage(change, usage);
      if (confidence) {
        hits.push({ change, target, file: usage.file, line: usage.line, confidence });
      }
    }
  }
  return hits;
}

function hitKey(hit: Hit): string {
  const { provider, kind, operation, field } = hit.change;
  return JSON.stringify([provider, kind, operation, field, hit.file, hit.confidence]);
}

async function scanTree(repoDir: string, context: RescanContext) {
  const { files } = await readSourceFiles(repoDir);
  const { usages, unparsed } = scanApiUsage(files);
  return { files: files.map((file) => file.path), hits: findHits(usages, context), unparsed };
}

/** Rescan only ever compares the target's hits, and literal hits of other removals. */
function isCompared(hit: Hit): boolean {
  return hit.target || hit.confidence === ImpactConfidence.CONFIRMED;
}

/**
 * `impacted` is the impact record's files, the only ones the refactor sends.
 * A literal match of the target anywhere else would fail every attempt, so
 * recording the baseline fails instead, before any model call.
 */
export async function recordRescanBaseline(
  repoDir: string,
  context: RescanContext | undefined,
  impacted: string[],
): Promise<RescanBaseline | undefined> {
  if (!context) return undefined;
  const { files, hits, unparsed } = await scanTree(repoDir, context);

  const listed = new Set(impacted);
  const unlisted = new Map<string, number[]>();
  for (const hit of hits) {
    if (hit.target && hit.confidence === ImpactConfidence.CONFIRMED && !listed.has(hit.file)) {
      unlisted.set(hit.file, [...(unlisted.get(hit.file) ?? []), hit.line]);
    }
  }
  if (context.target && unlisted.size > 0) {
    const where = [...unlisted].map(([file, lines]) => `${file} (line ${lines.join(', ')})`).join(', ');
    throw new Error(
      `${where} ${describe(context.target)}, but the impact record does not list it: the default branch moved since the scan, and the refactor only sends the files the scan found. Re-scan the repository, then migrate again.`,
    );
  }

  const counts: Record<string, number> = {};
  for (const hit of hits.filter(isCompared)) {
    const key = hitKey(hit);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return { files, hits: counts, unparsed };
}

function isBaseline(value: unknown): value is RescanBaseline {
  const baseline = value as Record<string, unknown> | null;
  return (
    typeof baseline === 'object' &&
    baseline !== null &&
    Array.isArray(baseline.files) &&
    baseline.files.every((file) => typeof file === 'string') &&
    typeof baseline.hits === 'object' &&
    baseline.hits !== null &&
    Object.values(baseline.hits).every((count) => Number.isInteger(count)) &&
    Array.isArray(baseline.unparsed) &&
    baseline.unparsed.every((file) => typeof file === 'string')
  );
}

function describe(change: RescanChange): string {
  const where = change.operation ?? `the ${change.provider} API`;
  switch (change.kind) {
    case 'model_retired':
      return `sends the retired model ${change.field}`;
    case 'endpoint_removed':
      return `calls the removed endpoint ${change.operation}`;
    case 'param_removed':
      return `sends ${change.field}, which ${where} no longer accepts`;
    case 'param_renamed':
      return `sends ${change.field}, which ${where} renamed`;
    case 'param_now_required':
      return `leaves out ${change.field}, which ${where} now requires`;
    case 'enum_value_removed':
      return `sends ${change.field}, a value ${where} removed`;
    default:
      return `matches the ${change.kind} change to ${change.field ?? where}`;
  }
}

/**
 * Re-scans the migrated tree. The change being migrated must be gone: a
 * literal match always fails, and a match only known at runtime fails where
 * there was none before, since the scan cannot prove that call is fixed.
 * Every other retirement or removal must not be newly used. Returns the
 * reason for the next refactor attempt, or undefined to pass.
 */
export async function rescan(
  repoDir: string,
  context: RescanContext | undefined,
  baseline: unknown,
): Promise<string | undefined> {
  if (!context) return undefined;
  if (!isBaseline(baseline)) {
    throw new Error('no re-scan baseline was recorded before the migration');
  }

  // The refactor only rewrites files the clone had, so anything else came from
  // repository scripts and is not the migration's to fix.
  const cloned = new Set(baseline.files);
  const scanned = await scanTree(repoDir, context);
  const hits = scanned.hits.filter((hit) => cloned.has(hit.file));
  const unparsed = scanned.unparsed.filter((file) => cloned.has(file));
  const groups = new Map<string, Hit[]>();
  for (const hit of hits) {
    const key = hitKey(hit);
    groups.set(key, [...(groups.get(key) ?? []), hit]);
  }

  const problems: string[] = [];
  for (const [key, group] of groups) {
    const [{ change, target, file, confidence }] = group;
    const before = baseline.hits[key] ?? 0;
    const lines = group.map((hit) => hit.line).join(', ');
    const literal = confidence === ImpactConfidence.CONFIRMED;

    if (target && literal) {
      problems.push(`${file} (line ${lines}) still ${describe(change)}.`);
    } else if (group.length > before && target) {
      problems.push(
        `${file} (line ${lines}) builds part of its request at runtime, so the re-scan cannot show it no longer ${describe(change)}.`,
      );
    } else if (group.length > before && literal) {
      problems.push(
        `${file} (line ${lines}) newly ${describe(change)}: ${group.length} call(s) now, ${before} before the migration.`,
      );
    }
  }

  for (const file of unparsed) {
    if (!baseline.unparsed.includes(file)) {
      problems.push(`${file} no longer parses, so the re-scan cannot show its API calls are fixed.`);
    }
  }

  return problems.length > 0 ? problems.join('\n') : undefined;
}
