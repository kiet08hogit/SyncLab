import { Parser } from 'htmlparser2';

export const CHANGE_KINDS = [
  'model_retired',
  'param_removed',
  'param_renamed',
  'param_now_required',
  'enum_value_removed',
  'endpoint_removed',
  'behavior_changed',
] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** A breaking change read from release notes or a changelog by the classifier. */
export interface ClassifiedChange {
  kind: ChangeKind;
  operation: string | null;
  field: string | null;
  replacement: string | null;
  /** YYYY-MM-DD, or null when the model gave no real date. */
  effectiveAt: string | null;
  /** Left for the caller, which knows which added section was classified. */
  section: string | null;
  /** A quote that appears verbatim in the snapshot content. */
  evidence: string;
}

export interface DroppedCandidate {
  candidate: unknown;
  reason: string;
}

export interface VerifiedChanges {
  changes: ClassifiedChange[];
  dropped: DroppedCandidate[];
}

export interface AddedSection {
  /**
   * The headings above the lines, outermost first and joined by " / ", such
   * as "0.123.0 (2026-09-01) / Features", or '' before any heading.
   */
  section: string;
  lines: string[];
}

const HEADING_LINE = /^(#{1,6}) (.*)$/;

/** A heading keeps its level as "#" marks, so a section can name its parents. */
function headingLine(level: number, text: string): string {
  return `${'#'.repeat(level)} ${text}`;
}
// Icon fonts put private-use characters into headings.
const PRIVATE_USE = /[-]/g;

function clean(text: string): string {
  return text.replace(PRIVATE_USE, '').replace(/\s+/g, ' ').trim();
}

// Page chrome, and markup that only holds icons or controls.
const SKIPPED = new Set([
  'head',
  'script',
  'style',
  'noscript',
  'template',
  'nav',
  'footer',
  'header',
  'button',
  'svg',
]);
// Elements whose text is one line of the output.
const LINE_ELEMENTS = new Set([
  'p',
  'li',
  'tr',
  'dt',
  'dd',
  'blockquote',
  'pre',
  'figcaption',
  'caption',
]);
// Containers whose start or end separates the text around them.
const BREAK_ELEMENTS = new Set([
  'div',
  'section',
  'article',
  'main',
  'aside',
  'ul',
  'ol',
  'dl',
  'table',
  'thead',
  'tbody',
  'details',
  'summary',
  'br',
  'hr',
]);
const HEADING = /^h[1-6]$/;

/**
 * The page as plain lines: each heading as "## heading" (one "#" per level), then each paragraph,
 * list item and table row as one line (cells joined by " | ") with its
 * whitespace collapsed. Navigation, headers, footers, scripts and styles are
 * left out, and so is everything outside main when the page has one, so a
 * snapshot hashes the notes rather than the page chrome. A
 * nested list ends its parent item's line, so every item stays its own line.
 */
function extractHtml(html: string): string[] {
  const lines: Array<{ text: string; inMain: boolean }> = [];
  let buffer = '';
  let mainDepth = 0;
  let headingLevel = 0;
  let skipDepth = 0;
  let rowDepth = 0;
  let cells: string[] | null = null;

  const flush = () => {
    const text = clean(buffer);
    buffer = '';
    if (text !== '') {
      lines.push({
        text: headingLevel > 0 ? headingLine(headingLevel, text) : text,
        inMain: mainDepth > 0,
      });
    }
  };

  const parser = new Parser(
    {
      onopentag(name) {
        if (SKIPPED.has(name) || skipDepth > 0) {
          // Void elements never reach onclosetag through the skipped branch,
          // and none of SKIPPED is void, so the depth stays balanced.
          if (SKIPPED.has(name)) skipDepth++;
          return;
        }
        if (name === 'main') {
          flush();
          mainDepth++;
          return;
        }
        if (rowDepth > 0) {
          // Inside a table row, block markup only separates words.
          if (name === 'td' || name === 'th') {
            buffer = '';
          } else {
            buffer += ' ';
          }
          return;
        }
        if (name === 'tr') {
          flush();
          rowDepth++;
          cells = [];
        } else if (HEADING.test(name)) {
          flush();
          headingLevel = Number(name[1]);
        } else if (LINE_ELEMENTS.has(name) || BREAK_ELEMENTS.has(name)) {
          flush();
        }
      },
      ontext(text) {
        if (skipDepth === 0) buffer += text;
      },
      onclosetag(name) {
        if (SKIPPED.has(name)) {
          skipDepth = Math.max(0, skipDepth - 1);
          return;
        }
        if (skipDepth > 0) return;
        if (name === 'main') {
          flush();
          mainDepth = Math.max(0, mainDepth - 1);
          return;
        }
        if (rowDepth > 0) {
          if ((name === 'td' || name === 'th') && cells) {
            cells.push(clean(buffer));
            buffer = '';
          } else if (name === 'tr') {
            rowDepth--;
            const row = cells ?? [];
            cells = null;
            buffer = '';
            if (row.some((cell) => cell !== '')) {
              // A literal " | " inside a cell would make the row ambiguous.
              lines.push({
                text: row.map((cell) => cell.split(' | ').join(' / ')).join(' | '),
                inMain: mainDepth > 0,
              });
            }
          } else {
            buffer += ' ';
          }
          return;
        }
        if (HEADING.test(name)) {
          flush();
          headingLevel = 0;
        } else if (LINE_ELEMENTS.has(name) || BREAK_ELEMENTS.has(name)) {
          flush();
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  flush();

  // Docs sites render their sidebars as plain lists, not always inside a nav.
  // When the page marks its content with main, that is all that is kept.
  const content = lines.some((line) => line.inMain) ? lines.filter((line) => line.inMain) : lines;
  return content.map((line) => line.text);
}

const MARKDOWN_HEADING = /^(#{1,6})\s+(.*?)\s*#*$/;

function extractMarkdown(markdown: string): string[] {
  const lines: string[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const heading = MARKDOWN_HEADING.exec(line);
    lines.push(heading ? headingLine(heading[1].length, clean(heading[2])) : line);
  }
  return lines;
}

/**
 * Normalized text of a release notes page or changelog: one line per
 * heading ("## heading", one "#" per level), paragraph, list item or table row. It is
 * deterministic, so the same page always hashes the same, and every piece of
 * evidence a classifier quotes can be checked against it.
 */
export function extractText(body: string, format: 'html' | 'markdown'): string {
  return (format === 'html' ? extractHtml(body) : extractMarkdown(body)).join('\n');
}

/**
 * The lines of current that previous did not have, grouped under the
 * headings above them, in page order, so a changelog entry reads as
 * "0.123.0 (2026-09-01) / Features" rather than a bare "Features". A line counts as new only if no line of
 * previous is identical to it, so an entry that moved, or a repeated line such
 * as a "Features" heading, is not new. Only these lines are classified, which
 * is why the first snapshot of a source is a baseline and not classified.
 */
export function addedSections(previous: string, current: string): AddedSection[] {
  const known = new Set(previous.split('\n'));
  const sections: AddedSection[] = [];
  // The open heading at each level; a heading closes every deeper one.
  const headings: string[] = [];
  let group: AddedSection | null = null;

  for (const line of current.split('\n')) {
    const heading = HEADING_LINE.exec(line);
    if (heading) {
      const level = heading[1].length;
      headings.length = level - 1;
      headings[level - 1] = heading[2];
      group = null;
      continue;
    }
    if (line === '' || known.has(line)) continue;
    if (!group) {
      group = { section: headings.filter(Boolean).join(' / '), lines: [] };
      sections.push(group);
    }
    group.lines.push(line);
  }

  return sections;
}

// Column widths of breaking_changes in prisma/schema.prisma.
const MAX_NAME_LENGTH = 255;
const MAX_REPLACEMENT_LENGTH = 1024;
// Shorter quotes ("removed", "the model") would match almost any snapshot.
export const MIN_EVIDENCE_LENGTH = 20;

type Check<T> = { ok: true; value: T } | { ok: false; reason: string };

function optionalText(value: unknown, name: string, maxLength: number): Check<string | null> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, reason: `${name} is not a string` };
  const text = value.trim();
  if (text.length > maxLength) {
    return { ok: false, reason: `${name} is longer than ${maxLength} characters` };
  }
  return { ok: true, value: text === '' ? null : text };
}

/** "2026-10-01" as is; "2026-02-30", "Q3 2026" or anything else as null. */
function realDate(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text) ? text : null;
}

function checkCandidate(candidate: unknown, snapshotContent: string): Check<ClassifiedChange> {
  if (candidate === null || typeof candidate !== 'object') {
    return { ok: false, reason: 'not an object' };
  }
  const item = candidate as Record<string, unknown>;

  if (!CHANGE_KINDS.includes(item.kind as ChangeKind)) {
    return { ok: false, reason: `unknown kind ${JSON.stringify(item.kind)}` };
  }

  const operation = optionalText(item.operation, 'operation', MAX_NAME_LENGTH);
  if (!operation.ok) return operation;
  const field = optionalText(item.field, 'field', MAX_NAME_LENGTH);
  if (!field.ok) return field;
  const replacement = optionalText(item.replacement, 'replacement', MAX_REPLACEMENT_LENGTH);
  if (!replacement.ok) return replacement;
  if (operation.value === null && field.value === null) {
    return { ok: false, reason: 'names neither an operation nor a field' };
  }

  if (typeof item.evidence !== 'string') {
    return { ok: false, reason: 'evidence is not a string' };
  }
  const evidence = item.evidence.trim();
  if (evidence.length < MIN_EVIDENCE_LENGTH) {
    return { ok: false, reason: `evidence is shorter than ${MIN_EVIDENCE_LENGTH} characters` };
  }
  if (!snapshotContent.includes(evidence)) {
    return { ok: false, reason: 'evidence is not verbatim in the snapshot' };
  }

  // A date that is not a real one costs the change its date, not the change.
  const effectiveAt = realDate(item.effectiveAt);

  return {
    ok: true,
    value: {
      kind: item.kind as ChangeKind,
      operation: operation.value,
      field: field.value,
      replacement: replacement.value,
      effectiveAt,
      section: null,
      evidence,
    },
  };
}

/**
 * Keeps the classifier's candidates that have the right shape and whose
 * evidence appears verbatim in the snapshot. The classifier is a model, so
 * this is what stops it from inventing a breaking change: a quote it did not
 * copy from the page cannot be stored. The first of two candidates about the
 * same kind, operation and field wins.
 */
export function verifyClassified(candidates: unknown[], snapshotContent: string): VerifiedChanges {
  const changes: ClassifiedChange[] = [];
  const dropped: DroppedCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const checked = checkCandidate(candidate, snapshotContent);
    if (!checked.ok) {
      dropped.push({ candidate, reason: checked.reason });
      continue;
    }
    const change = checked.value;
    const key = `${change.kind}|${change.operation ?? ''}|${change.field ?? ''}`;
    if (seen.has(key)) {
      dropped.push({ candidate, reason: 'duplicate of an earlier change' });
      continue;
    }
    seen.add(key);
    changes.push(change);
  }

  return { changes, dropped };
}
