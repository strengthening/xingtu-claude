/**
 * Minimal RFC 4180-style CSV line splitter.
 * Handles quoted fields, embedded commas and doubled quotes (""), which is
 * all the HYG files need. Multi-line quoted fields are not supported.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(field);
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  out.push(field);
  return out;
}

/** Parse a numeric CSV cell; empty or non-numeric cells become NaN. */
export function parseNum(cell: string | undefined): number {
  if (cell === undefined) return Number.NaN;
  const s = cell.trim();
  return s === '' ? Number.NaN : Number(s);
}
