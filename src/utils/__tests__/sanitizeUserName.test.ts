import { sanitizeUserName } from '../sanitizeUserName';

describe('sanitizeUserName', () => {
  it('returns the trimmed name for valid input', () => {
    expect(sanitizeUserName('  Ana  ')).toBe('Ana');
  });

  it('returns the same string when there is nothing to trim', () => {
    expect(sanitizeUserName('Bruno')).toBe('Bruno');
  });

  it('returns null for an empty string', () => {
    expect(sanitizeUserName('')).toBeNull();
  });

  it('returns null for a string made only of spaces', () => {
    expect(sanitizeUserName('    ')).toBeNull();
  });

  it('returns null for a string made only of tabs/newlines', () => {
    expect(sanitizeUserName('\t\n  \t')).toBeNull();
  });

  it('preserves internal spaces for multi-word names', () => {
    expect(sanitizeUserName('  Ana María  ')).toBe('Ana María');
  });
});
