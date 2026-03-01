/**
 * Normalize text for safe JSON output: convert curly quotes and other
 * problematic Unicode characters to their ASCII equivalents.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/[\u201C\u201D]/g, '"')   // curly double quotes → straight
    .replace(/[\u2018\u2019]/g, "'")   // curly single quotes → straight
    .replace(/\u2013/g, '-')           // en dash → hyphen
    .replace(/\u2014/g, '--')          // em dash → double hyphen
    .replace(/\u2026/g, '...');        // ellipsis → three dots
}

/**
 * Normalise text for fuzzy matching: lower-case + replace common umlauts so
 * that e.g. searching "AO" also matches "ÄÖ" and vice-versa.
 */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/Ü/g, "U")
    .replace(/Ä/g, "A")
    .replace(/Ö/g, "O")
    .replace(/ü/g, "u")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .toLowerCase();
}
