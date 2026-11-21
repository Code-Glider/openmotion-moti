/** Unicode coverage is not the same as grapheme shaping. This predicate decides
 * which scalar values require a standalone font cmap glyph in our offline audits.
 * Unicode controls and Default_Ignorable_Code_Point (including BiDi controls,
 * ZWJ/ZWNJ and variation selectors) are not missing-glyph errors. Ordinary
 * combining marks such as Hebrew niqqud and Arabic/Syriac harakat remain required.
 * Keep whitespace handling caller-specific: font audits can check the space glyph,
 * while visual specimens omit layout whitespace from the missing-glyph display.
 */
export function requiresFontGlyph(codepoint: number): boolean {
  return !/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(String.fromCodePoint(codepoint));
}
