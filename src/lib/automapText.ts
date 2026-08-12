// Invisible characters, and the money they hide. LAB-ONLY.
//
// 136 of the 142 bank rows in Ori's first real run carry U+202B (RIGHT-TO-LEFT
// EMBEDDING). The bank emits it before each Hebrew segment so its own PDF lays
// out correctly, and it survives the Excel export untouched. On screen it is
// invisible. In a string it is a character like any other, sitting between
// "מגדל/" and "טלפון".
//
// That one invisible character is why a ₪967/month securities purchase was
// filed as insurance: the curated key is "מגדל/טלפון", matching is by
// SUBSTRING, and "מגדל/‫טלפון" cannot contain it. No amount of adding
// keys fixes this — the mark can land between any two segments of any name, so
// every key would need every variant.
//
// 🔒 Why here and not in normalizeForLookup: that function is imported by the
// credit store, the mapping store, the import tab, /api/learn and the עו"ש tab.
// Cleaning the description at the LAB's own door fixes the lab completely and
// changes nothing any client runs today. The live version of this fix is a
// separate decision, and it is Ori's to make.

/**
 * Bidi controls and zero-width characters.
 *
 * ⚠️ DELETED, never replaced with a space. The mark sits INSIDE a merchant name
 * ("מגדל/‫טלפון"), so substituting a space would split the very word that
 * stripping exists to rejoin — and a key of "מגדל/ טלפון" matches nothing
 * either. This is the opposite of the maqaf rule in normalizeForLookup, where
 * the character really is punctuation between words.
 *
 *   U+200B–U+200F  zero-width space/non-joiner/joiner, LRM, RLM
 *   U+061C         Arabic letter mark
 *   U+202A–U+202E  embedding / override / pop-directional-formatting
 *   U+2066–U+2069  isolates (the modern replacement for the embeddings)
 *   U+FEFF         BOM, when a cell was concatenated from a file that had one
 */
// Written as escapes on purpose: the literal characters are invisible in an
// editor, so a class spelled out in raw form is one no reviewer can check.
const INVISIBLE_SRC = '[\\u200B-\\u200F\\u061C\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]'

/**
 * A description with nothing invisible left in it.
 *
 * Runs before categorisation and before display, so what the advisor reads and
 * what the lookup sees are the same string. Idempotent, and safe on text that
 * never had a mark in it.
 */
export function cleanDesc(desc: string): string {
  if (!desc) return ''
  return desc.replace(new RegExp(INVISIBLE_SRC, 'g'), '').replace(/\s{2,}/g, ' ').trim()
}

/**
 * True when the text carries at least one invisible character.
 *
 * A fresh RegExp per call, not a shared /g one: `lastIndex` on a global regex
 * survives between `.test()` calls, so a shared instance answers correctly on
 * one string and falsely on the next.
 */
export function hasInvisible(desc: string): boolean {
  return new RegExp(INVISIBLE_SRC).test(desc ?? '')
}
