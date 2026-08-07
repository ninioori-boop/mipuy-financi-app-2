import { describe, it, expect } from 'vitest'
import { extractJsonObject, parseGeneratedMapping, AUTOMAP_SYSTEM_PROMPT } from '@/lib/autoMap'

// Observed live 2026-08-07: the model opened with an English preamble, which ate
// into the output budget, and the mapping never closed. The old matcher looked
// for `{ ... }` and found nothing, so a nearly-complete answer was discarded.
const PREAMBLE = 'I need to carefully analyze all the documents to build a complete monthly financial mapping.\n\n'

describe('extractJsonObject', () => {
  it('returns a complete object untouched', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}')
  })

  it('skips a preamble before the JSON', () => {
    expect(extractJsonObject(PREAMBLE + '{"a":1}')).toBe('{"a":1}')
  })

  it('ignores braces inside strings', () => {
    const s = '{"note":"a { brace } in text","b":2}'
    expect(JSON.parse(extractJsonObject(s))).toEqual({ note: 'a { brace } in text', b: 2 })
  })

  it('ignores an escaped quote inside a string', () => {
    const s = '{"note":"he said \\"hi\\"","b":2}'
    expect(JSON.parse(extractJsonObject(s))).toEqual({ note: 'he said "hi"', b: 2 })
  })

  it('repairs a reply cut off mid-array', () => {
    const cut = '{"income":[{"name":"משכורת","amount":14000},{"name":"קצבה","amount":400}'
    expect(JSON.parse(extractJsonObject(cut))).toEqual({
      income: [{ name: 'משכורת', amount: 14000 }, { name: 'קצבה', amount: 400 }],
    })
  })

  it('repairs a reply cut off mid-object, dropping only the half-written row', () => {
    const cut = '{"fixed":[{"name":"ארנונה","amount":620}],"variable":[{"name":"סופרמ'
    const parsed = JSON.parse(extractJsonObject(cut))
    expect(parsed.fixed).toEqual([{ name: 'ארנונה', amount: 620 }])
    expect(parsed.variable ?? []).toEqual([])   // the incomplete row is gone, the rest survives
  })

  it('keeps every section that finished before the cut', () => {
    const cut = PREAMBLE +
      '{"creditScore":720,"income":[{"name":"משכורת","amount":14000}],' +
      '"fixed":[{"name":"משכנתא","amount":4200}],"variable":[{"name":"מזון'
    const parsed = JSON.parse(extractJsonObject(cut))
    expect(parsed.creditScore).toBe(720)
    expect(parsed.income).toHaveLength(1)
    expect(parsed.fixed).toHaveLength(1)
  })

  it('throws when there is no JSON at all', () => {
    expect(() => extractJsonObject('I cannot help with that.')).toThrow()
  })

  it('throws when the cut came before anything closed — nothing to salvage', () => {
    expect(() => extractJsonObject('{"income":[{"name":"משכ')).toThrow('נקטעה')
  })
})

describe('parseGeneratedMapping on a truncated reply', () => {
  it('recovers a usable mapping instead of losing the whole run', () => {
    const cut = PREAMBLE +
      '{"creditScore":700,"income":[{"name":"משכורת","amount":12000}],' +
      '"fixed":[{"name":"ארנונה","amount":620}],"variable":[{"name":"סופרמרק'
    const r = parseGeneratedMapping(cut)
    expect(r.creditScore).toBe(700)
    expect(r.income).toEqual([{ name: 'משכורת', amount: 12000 }])
    expect(r.fixed).toEqual([{ name: 'ארנונה', amount: 620 }])
    expect(r.variable).toEqual([])
  })
})

describe('AUTOMAP_SYSTEM_PROMPT', () => {
  // The rule that prevents the preamble has to be near the TOP: it lost its
  // salience once the prompt grew and it was still sitting only at the end.
  it('demands a bare JSON reply in the first quarter of the prompt', () => {
    const idx = AUTOMAP_SYSTEM_PROMPT.indexOf('התו הראשון בתשובה שלך חייב להיות')
    expect(idx).toBeGreaterThan(-1)
    expect(idx).toBeLessThan(AUTOMAP_SYSTEM_PROMPT.length / 4)
  })
})
