/**
 * Canonical stop word list for the brain engine.
 *
 * Single source of truth -- imported by quality-gate, linker, and reflection.
 * Contains the union of all previously separate stop word lists.
 */

export const STOP_WORDS: Set<string> = new Set([
  'a', 'about', 'above', 'after', 'again', 'all', 'also', 'an', 'and', 'any',
  'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below',
  'between', 'both', 'but', 'by', 'can', 'could', 'did', 'do', 'does',
  'doing', 'done', 'during', 'each', 'every', 'few', 'for', 'from',
  'further', 'has', 'had', 'have', 'he', 'her', 'here', 'his', 'how', 'i',
  'if', 'in', 'into', 'is', 'it', 'its', 'just', 'like', 'may', 'me',
  'might', 'more', 'most', 'my', 'no', 'not', 'of', 'off', 'on', 'once',
  'one', 'only', 'or', 'other', 'our', 'out', 'over', 'own', 'same', 'shall',
  'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'through', 'to', 'too',
  'under', 'up', 'use', 'used', 'using', 'very', 'was', 'we', 'were', 'what',
  'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with',
  'would', 'you', 'your',
]);

/**
 * Filter out stop words and words shorter than 2 characters.
 */
export function removeStopWords(words: string[]): string[] {
  return words.filter(w => w.length >= 2 && !STOP_WORDS.has(w));
}
