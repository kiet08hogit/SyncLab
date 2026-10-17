import { Parser } from 'htmlparser2';

export interface ExtractedTable {
  heading: string;
  rows: string[][];
}

export interface ParsedChange {
  kind: 'model_retired' | 'endpoint_removed';
  operation: string | null;
  field: string | null;
  replacement: string | null;
  /** YYYY-MM-DD, or null when the page gives no usable date. */
  effectiveAt: string | null;
  section: string;
  /** The verbatim line of the snapshot content the change was read from. */
  evidence: string;
}

export interface ParsedDeprecations {
  changes: ParsedChange[];
  /** Rows under a retirement table that name no model ID or endpoint, such as "Assistants API". */
  skipped: string[];
}

const CELL_SEPARATOR = ' | ';
// Icon fonts put private-use characters into headings.
const PRIVATE_USE = /[-]/g;

function clean(text: string): string {
  return text.replace(PRIVATE_USE, '').replace(/\s+/g, ' ').trim();
}

/** Every table on the page, with the nearest heading above it. */
export function extractTables(html: string): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  let heading = '';
  let headingText: string | null = null;
  let table: ExtractedTable | null = null;
  let row: string[] | null = null;
  let cell: string | null = null;
  let skipDepth = 0;

  const parser = new Parser(
    {
      onopentag(name) {
        if (name === 'script' || name === 'style' || name === 'noscript') {
          skipDepth++;
        } else if (/^h[1-6]$/.test(name)) {
          headingText = '';
        } else if (name === 'table') {
          table = { heading, rows: [] };
        } else if (name === 'tr' && table) {
          row = [];
        } else if ((name === 'td' || name === 'th') && row) {
          cell = '';
        } else if (name === 'br' && cell !== null) {
          cell += ' ';
        }
      },
      ontext(text) {
        if (skipDepth > 0) return;
        if (headingText !== null) headingText += text;
        if (cell !== null) cell += text;
      },
      onclosetag(name) {
        if (name === 'script' || name === 'style' || name === 'noscript') {
          skipDepth = Math.max(0, skipDepth - 1);
        } else if (/^h[1-6]$/.test(name) && headingText !== null) {
          heading = clean(headingText);
          headingText = null;
        } else if ((name === 'td' || name === 'th') && row && cell !== null) {
          row.push(clean(cell));
          cell = null;
        } else if (name === 'tr' && table && row) {
          if (row.some((value) => value !== '')) table.rows.push(row);
          row = null;
        } else if (name === 'table' && table) {
          if (table.rows.length > 0) tables.push(table);
          table = null;
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return tables;
}

/**
 * The tables as plain text: a heading line, then one line per row with its
 * cells joined by " | ". This is what a snapshot stores and hashes, so page
 * chrome that changes on every request (build IDs, nonces) never registers
 * as a change, and every piece of evidence is a whole line of it.
 */
export function normalizeTables(tables: ExtractedTable[]): string {
  return tables
    .map((table) =>
      [
        `## ${table.heading}`,
        // A literal " | " inside a cell would make the row ambiguous.
        ...table.rows.map((row) =>
          row.map((value) => value.split(CELL_SEPARATOR).join(' / ')).join(CELL_SEPARATOR),
        ),
      ].join('\n'),
    )
    .join('\n\n');
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** "November 30, 2026", "Apr 1, 2027", "Sept. 30, 2026" or "2026-09-28" (any dash). */
export function parseDate(text: string): string | null {
  const value = text.replace(/[‐-―−]/g, '-').trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const named = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(value);
  if (!named) {
    return null;
  }
  const month = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase());
  const day = Number(named[2]);
  const year = Number(named[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (month < 0 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

const MODEL_ID = /^[a-z0-9][a-z0-9._:-]*$/;
const ENDPOINT = /^\/v\d+\/[a-z0-9/_.-]+$/;

/**
 * The model IDs or endpoint paths a cell names. Display names ("GPT-4o"),
 * product names ("Assistants API") and prose ("New fine-tuning training on
 * babbage-002", which retires a capability, not the model) are not IDs, so
 * a row like that names nothing rather than a wrong model.
 */
export function extractIds(cell: string): string[] {
  const parts = cell
    .replace(/[()]/g, ',')
    .split(/,| \/ | and /)
    .map((part) => part.trim().replace(/^including /, ''));
  const ids = parts.filter((part) => MODEL_ID.test(part) || ENDPOINT.test(part));
  return [...new Set(ids)];
}

function blankToNull(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  return text === '' || /^(n\/a|none|[-–—])$/i.test(text) ? null : text;
}

interface Columns {
  date: number;
  model: number;
  replacement: number;
}

/**
 * A retirement table has a shutdown or retirement date column and a model
 * column. "Tentative retirement date" is deliberately not one: it belongs to
 * the status overview, which lists models that are not being retired.
 */
function retirementColumns(header: string[]): Columns | null {
  const date = header.findIndex((name) => /^(shutdown|retirement) date$/i.test(name));
  const model = header.findIndex(
    (name) => /model|system|snapshot/i.test(name) && !/price|replacement|substitute/i.test(name),
  );
  if (date < 0 || model < 0) {
    return null;
  }
  return {
    date,
    model,
    replacement: header.findIndex((name) => /replacement|substitute/i.test(name)),
  };
}

/**
 * Reads model and endpoint retirements from a deprecations snapshot's content
 * (the output of normalizeTables), so a replayed snapshot always yields the
 * same changes.
 */
export function parseDeprecations(content: string): ParsedDeprecations {
  const changes: ParsedChange[] = [];
  const skipped: string[] = [];
  // Pages list announcements newest first, so the first mention of a model wins.
  const seen = new Set<string>();

  for (const block of content.split('\n\n')) {
    const [headingLine, headerLine, ...lines] = block.split('\n');
    if (!headingLine?.startsWith('## ') || !headerLine) continue;
    const section = headingLine.slice(3);
    const columns = retirementColumns(headerLine.split(CELL_SEPARATOR));
    if (!columns) continue;

    for (const line of lines) {
      const cells = line.split(CELL_SEPARATOR);
      const ids = extractIds(cells[columns.model] ?? '');
      if (ids.length === 0) {
        skipped.push(line);
        continue;
      }
      const effectiveAt = parseDate(cells[columns.date] ?? '');
      const replacement = columns.replacement >= 0 ? blankToNull(cells[columns.replacement]) : null;

      for (const id of ids) {
        const endpoint = ENDPOINT.test(id);
        const kind = endpoint ? 'endpoint_removed' : 'model_retired';
        if (seen.has(`${kind}:${id}`)) continue;
        seen.add(`${kind}:${id}`);
        changes.push({
          kind,
          operation: endpoint ? id : null,
          field: endpoint ? null : id,
          replacement,
          effectiveAt,
          section,
          evidence: line,
        });
      }
    }
  }

  return { changes, skipped };
}

/** The key that makes the same change, read again, update its row instead of adding one. */
export function subjectKey(change: Pick<ParsedChange, 'operation' | 'field'>): string {
  return `${change.operation ?? ''}|${change.field ?? ''}`;
}
