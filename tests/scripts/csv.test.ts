import { describe, expect, it } from 'vitest';
import { parseNum, splitCsvLine } from '../../scripts/lib/csv';

describe('splitCsvLine', () => {
  it('splits plain and quoted fields', () => {
    expect(splitCsvLine('1,"Sirius",101.28,,"a,b"')).toEqual(['1', 'Sirius', '101.28', '', 'a,b']);
  });
  it('unescapes doubled quotes and ignores CR', () => {
    expect(splitCsvLine('"say ""hi""",x\r')).toEqual(['say "hi"', 'x']);
  });
});

describe('parseNum', () => {
  it('maps empty cells to NaN', () => {
    expect(parseNum('')).toBeNaN();
    expect(parseNum(undefined)).toBeNaN();
    expect(parseNum(' -1.44 ')).toBe(-1.44);
  });
});
