import { describe, expect, it } from 'vitest'
import { formatQuantity, formatTotals, parseAmount, sumQuantities } from './quantity'

describe('sumQuantities', () => {
  it('adds grams and kilos: 500 g + 1 kg = 1.5 kg', () => {
    expect(sumQuantities([{ quantity: 500, unit: 'g' }, { quantity: 1, unit: 'kg' }])).toEqual([{ quantity: 1.5, unit: 'kg' }])
  })
  it('keeps small amounts in grams and adds millilitres with litres', () => {
    expect(sumQuantities([{ quantity: 200, unit: 'g' }, { quantity: 300, unit: 'g' }])).toEqual([{ quantity: 500, unit: 'g' }])
    expect(sumQuantities([{ quantity: 250, unit: 'ml' }, { quantity: 0.75, unit: 'l' }])).toEqual([{ quantity: 1, unit: 'l' }])
  })
  it('adds the same unit with itself and plain counts with counts', () => {
    expect(sumQuantities([{ quantity: 2, unit: 'clove' }, { quantity: 3, unit: 'clove' }])).toEqual([{ quantity: 5, unit: 'clove' }])
    expect(sumQuantities([{ quantity: 2, unit: null }, { quantity: 1, unit: null }])).toEqual([{ quantity: 3, unit: null }])
  })
  it('never turns one kind of unit into another (a cup is not grams, a spoon is not a cup, a count is not a piece)', () => {
    const totals = sumQuantities([{ quantity: 1, unit: 'cup' }, { quantity: 200, unit: 'g' }, { quantity: 2, unit: 'tbsp' }, { quantity: 1, unit: 'spoon' }, { quantity: 2, unit: null }, { quantity: 1, unit: 'piece' }])
    expect(totals).toHaveLength(6)
  })
  it('ignores a zero, negative or non-numeric quantity', () => {
    expect(sumQuantities([{ quantity: 0, unit: 'g' }, { quantity: -1, unit: 'g' }, { quantity: NaN, unit: 'g' }])).toEqual([])
  })
})

describe('formatQuantity', () => {
  it('writes the unit with its Arabic number form', () => {
    expect(formatQuantity({ quantity: 1, unit: 'clove' })).toBe('1 فص')
    expect(formatQuantity({ quantity: 2, unit: 'clove' })).toBe('فصان')
    expect(formatQuantity({ quantity: 3, unit: 'clove' })).toBe('3 فصوص')
    expect(formatQuantity({ quantity: 11, unit: 'clove' })).toBe('11 فص')
    expect(formatQuantity({ quantity: 1.5, unit: 'kg' })).toBe('1.5 كيلو')
    expect(formatQuantity({ quantity: 250, unit: 'g' })).toBe('250 جرام')
    expect(formatQuantity({ quantity: 0.5, unit: 'cup' })).toBe('0.5 كوب')
    expect(formatQuantity({ quantity: 4, unit: null })).toBe('4')
  })
  it('joins the totals of different kinds', () => {
    expect(formatTotals([{ quantity: 1.5, unit: 'kg' }, { quantity: 3, unit: 'piece' }])).toBe('1.5 كيلو + 3 حبات')
  })
})

describe('parseAmount', () => {
  it('reads Western and Arabic digits, decimal marks and fractions', () => {
    expect(parseAmount('2')).toBe(2)
    expect(parseAmount('٢')).toBe(2)
    expect(parseAmount('1.5')).toBe(1.5)
    expect(parseAmount('١٫٥')).toBe(1.5)
    expect(parseAmount('1,5')).toBe(1.5)
    expect(parseAmount('1/2')).toBe(0.5)
    expect(parseAmount(' ٣ ')).toBe(3)
  })
  it('refuses anything that is not a positive number', () => {
    for (const text of ['', 'abc', '0', '-2', '1/0', '2 كيلو', '1e3', '999999']) expect(parseAmount(text)).toBeNull()
  })
})
