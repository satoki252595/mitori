/**
 * Parse CSV text into rows of fields (RFC 4180 subset): quoted fields may contain commas, line breaks and doubled
 * quotes; both LF and CRLF end a row; blank lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Split the header row off and return one object per record, keyed by the (trimmed, lower-cased) header names. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const [header, ...rest] = parseCsv(text);
  if (!header) return [];
  const names = header.map((h) => h.trim().toLowerCase());
  return rest.map((cells) => Object.fromEntries(names.map((name, i) => [name, cells[i] ?? ""])));
}
