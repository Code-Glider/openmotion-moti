/**
 * Lossless fallback tokenization of a legacy caption's single text node.
 * Return null if the supplied timed words cannot be paired with the exact
 * logical Unicode content. No reordering, normalization or inferred timing.
 * Full non-mutating overlay measurement remains a separate roadmap item.
 */
export function splitCaptionWordRuns(text: string, expectedWords: readonly string[]): string[] | null {
  if (!text || !expectedWords.length || expectedWords.some((word) => !word)) return null;
  const runs = Array.from(text.matchAll(/\S+\s*/gu), (match) => match[0]);
  if (runs.length !== expectedWords.length) return null;
  const prefixLength = text.search(/\S/u);
  if (prefixLength > 0) runs[0] = text.slice(0, prefixLength) + runs[0];
  if (runs.join("") !== text) return null;
  for (let i = 0; i < runs.length; i++) {
    if (runs[i].trim() !== expectedWords[i]) return null;
  }
  return runs;
}
