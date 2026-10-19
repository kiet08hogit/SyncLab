export const ImpactConfidence = {
  CONFIRMED: 'confirmed',
  POSSIBLE: 'possible',
} as const;

export type ImpactConfidence = (typeof ImpactConfidence)[keyof typeof ImpactConfidence];

export interface MatchChange {
  kind: string;
  operation: string | null;
  field: string | null;
}

export interface MatchUsage {
  file: string;
  operation: string | null;
  params: string[];
  modelIds: string[];
  dynamic: boolean;
}

export interface ImpactChange extends MatchChange {
  id: string;
  providerId: string;
}

export interface ImpactUsage extends MatchUsage {
  providerId: string;
}

export interface ImpactScan {
  repositoryId: string;
  usages: ImpactUsage[];
}

export interface ImpactDraft {
  breakingChangeId: string;
  repositoryId: string;
  confidence: ImpactConfidence;
  files: string[];
}

type Gate = 'open' | 'match' | 'unknown' | 'miss';

/** Brace contents differ between a spec template and a scanned URL, so compare them as `{}`. */
function canonical(operation: string): string {
  return operation.replace(/\{[^}]*\}/g, '{}');
}

/**
 * A deprecation page names an endpoint as a bare path. A scanned call names
 * the method too, so `/v1/edits` matches `POST /v1/edits`.
 */
function sameOperation(changeOp: string, usageOp: string): boolean {
  const change = canonical(changeOp);
  const usage = canonical(usageOp);
  if (change === usage) return true;
  return !change.includes(' ') && (usage === change || usage.endsWith(` ${change}`));
}

function operationGate(changeOp: string | null, usage: MatchUsage): Gate {
  if (!changeOp) return 'open';
  if (!usage.operation) return usage.dynamic ? 'unknown' : 'miss';
  return sameOperation(changeOp, usage.operation) ? 'match' : 'miss';
}

function enumParam(field: string | null): string | null {
  if (!field) return null;
  const name = field.split('=', 1)[0]?.trim() ?? '';
  return name || null;
}

function matchModel(field: string | null, usage: MatchUsage, gate: Gate): ImpactConfidence | null {
  if (!field || gate === 'miss') return null;
  if (usage.modelIds.includes(field)) {
    return gate === 'unknown' ? ImpactConfidence.POSSIBLE : ImpactConfidence.CONFIRMED;
  }
  if (usage.modelIds.length > 0) return null;
  return usage.dynamic ? ImpactConfidence.POSSIBLE : null;
}

/**
 * `present`: the call breaks when it sends the parameter (removed or renamed).
 * `absent`: the call breaks when it does not send a newly required parameter.
 * `enum`: the removed value is not stored, so a call that sends the parameter
 * can only be possible.
 */
function matchParam(
  field: string | null,
  usage: MatchUsage,
  gate: Gate,
  mode: 'present' | 'absent' | 'enum',
): ImpactConfidence | null {
  const name = mode === 'enum' ? enumParam(field) : field;
  if (!name || gate === 'miss') return null;
  const folded = name.toLowerCase();
  const listed = usage.params.some((param) => param.toLowerCase() === folded);

  if (mode === 'absent') {
    if (listed) return null;
    if (gate === 'match' && !usage.dynamic) return ImpactConfidence.CONFIRMED;
    if (gate === 'open' && !usage.dynamic) return null;
    return ImpactConfidence.POSSIBLE;
  }

  if (!listed && !usage.dynamic) return null;
  if (mode === 'enum' || gate === 'open' || gate === 'unknown' || !listed) {
    return ImpactConfidence.POSSIBLE;
  }
  return ImpactConfidence.CONFIRMED;
}

function matchBehavior(gate: Gate): ImpactConfidence | null {
  if (gate === 'match') return ImpactConfidence.CONFIRMED;
  if (gate === 'unknown') return ImpactConfidence.POSSIBLE;
  return null;
}

/** How one usage relates to one change. Provider is compared by the caller. */
export function matchUsage(change: MatchChange, usage: MatchUsage): ImpactConfidence | null {
  const gate = operationGate(change.operation, usage);
  switch (change.kind) {
    case 'model_retired':
      return matchModel(change.field, usage, gate);
    case 'endpoint_removed':
      if (gate === 'match') return ImpactConfidence.CONFIRMED;
      return gate === 'unknown' ? ImpactConfidence.POSSIBLE : null;
    case 'param_removed':
    case 'param_renamed':
      return matchParam(change.field, usage, gate, 'present');
    case 'param_now_required':
      return matchParam(change.field, usage, gate, 'absent');
    case 'enum_value_removed':
      return matchParam(change.field, usage, gate, 'enum');
    case 'behavior_changed':
      return matchBehavior(gate);
    default:
      return null;
  }
}

/** One row per change and repository. A literal hit makes the row confirmed. */
export function collectImpacts(changes: ImpactChange[], scans: ImpactScan[]): ImpactDraft[] {
  const drafts: ImpactDraft[] = [];
  for (const scan of scans) {
    const hits = new Map<string, { confidence: ImpactConfidence; files: Set<string> }>();
    for (const usage of scan.usages) {
      for (const change of changes) {
        if (change.providerId !== usage.providerId) continue;
        const confidence = matchUsage(change, usage);
        if (!confidence) continue;
        const hit = hits.get(change.id) ?? { confidence, files: new Set<string>() };
        if (confidence === ImpactConfidence.CONFIRMED) hit.confidence = ImpactConfidence.CONFIRMED;
        hit.files.add(usage.file);
        hits.set(change.id, hit);
      }
    }
    for (const [breakingChangeId, hit] of hits) {
      drafts.push({
        breakingChangeId,
        repositoryId: scan.repositoryId,
        confidence: hit.confidence,
        files: [...hit.files].sort(),
      });
    }
  }
  return drafts;
}
