import { describe, it, expect } from 'vitest'
import {
  calcIncomeTaxAnnual,
  calcIncomeTaxMonthly,
  calcCompanyTaxMonthly,
  calcBituachLeumiMonthly,
  calcVat,
  TAX_POINT_ANNUAL,
  BL_REDUCED_CAP,
  BL_REDUCED_RATE,
  BL_FULL_RATE,
  COMPANY_TAX_RATE,
} from '../businessTax'

describe('calcIncomeTaxAnnual', () => {
  it('returns 0 for non-positive income', () => {
    expect(calcIncomeTaxAnnual(0, 0)).toBe(0)
    expect(calcIncomeTaxAnnual(-5000, 0)).toBe(0)
  })

  it('taxes the first bracket at 10%', () => {
    expect(calcIncomeTaxAnnual(84_120, 0)).toBeCloseTo(8_412, 2)
  })

  it('spans into the second bracket correctly', () => {
    // 84,120 * 10% + (100,000 - 84,120) * 14%
    expect(calcIncomeTaxAnnual(100_000, 0)).toBeCloseTo(8_412 + 15_880 * 0.14, 2)
  })

  it('subtracts tax-credit points and never goes negative', () => {
    const gross = calcIncomeTaxAnnual(100_000, 0)
    const withPoints = calcIncomeTaxAnnual(100_000, 2.25)
    expect(withPoints).toBeCloseTo(Math.max(0, gross - 2.25 * TAX_POINT_ANNUAL), 2)
    // huge credit floors at 0
    expect(calcIncomeTaxAnnual(50_000, 100)).toBe(0)
  })
})

describe('calcIncomeTaxMonthly', () => {
  it('equals the annualized calc divided by 12', () => {
    expect(calcIncomeTaxMonthly(10_000, 2.25)).toBeCloseTo(calcIncomeTaxAnnual(120_000, 2.25) / 12, 6)
  })
})

describe('calcCompanyTaxMonthly', () => {
  it('applies a flat 23% on profit', () => {
    expect(calcCompanyTaxMonthly(10_000)).toBeCloseTo(10_000 * COMPANY_TAX_RATE, 2)
  })
  it('returns 0 for a loss', () => {
    expect(calcCompanyTaxMonthly(-3_000)).toBe(0)
  })
})

describe('calcBituachLeumiMonthly', () => {
  it('returns 0 for non-positive income', () => {
    expect(calcBituachLeumiMonthly(0)).toBe(0)
  })

  it('uses only the reduced rate below the 60%-of-average cap', () => {
    const income = 5_000 // below BL_REDUCED_CAP
    expect(calcBituachLeumiMonthly(income)).toBeCloseTo(income * BL_REDUCED_RATE, 2)
  })

  it('applies the full rate on the slice above the cap', () => {
    const income = 10_000
    const expected = BL_REDUCED_CAP * BL_REDUCED_RATE + (income - BL_REDUCED_CAP) * BL_FULL_RATE
    expect(calcBituachLeumiMonthly(income)).toBeCloseTo(expected, 2)
  })
})

describe('calcVat', () => {
  it('computes output, input and net payable', () => {
    const { output, input, payable } = calcVat(10_000, 4_000)
    expect(output).toBeCloseTo(1_800, 2)
    expect(input).toBeCloseTo(720, 2)
    expect(payable).toBeCloseTo(1_080, 2)
  })

  it('can be refundable (negative payable) when input exceeds output', () => {
    expect(calcVat(1_000, 5_000).payable).toBeLessThan(0)
  })
})
