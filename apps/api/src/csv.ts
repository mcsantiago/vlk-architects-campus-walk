/**
 * Minimal RFC 4180 CSV: quoted fields, doubled quotes, CR/LF line ends. Small enough that a
 * dependency is not worth its weight, and the import gets exact line numbers for errors.
 */

export function toCsv(header: string[], rows: unknown[][]): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const str = v instanceof Date ? v.toISOString() : String(v);
    return /[",\r\n]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export interface CsvRecord {
  /** 1-based line of the record's first physical line, for error messages. */
  line: number;
  values: string[];
}

export function parseCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let values: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;
  if (text.startsWith('﻿')) i = 1; // Excel's BOM

  const endField = () => {
    values.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    if (values.length > 1 || values[0] !== '') records.push({ line: recordLine, values });
    values = [];
    recordLine = line;
  };

  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      line++;
      endRecord();
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error(`unterminated quoted field starting on line ${recordLine}`);
  if (field !== '' || values.length > 0) endRecord();
  return records;
}

/** Maps a header row onto each record; missing columns become ''. */
export function parseCsvObjects(text: string, columns: readonly string[]) {
  const [header, ...body] = parseCsv(text);
  if (!header) throw new Error('empty file');
  const names = header.values.map((h) => h.trim().toLowerCase());
  const missing = columns.filter((c) => !names.includes(c));
  if (missing.length) throw new Error(`missing columns: ${missing.join(', ')}`);
  return body.map(({ line, values }) => ({
    line,
    row: Object.fromEntries(columns.map((c) => [c, (values[names.indexOf(c)] ?? '').trim()])) as Record<string, string>,
  }));
}
