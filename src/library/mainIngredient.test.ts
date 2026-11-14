import { describe, expect, it } from 'vitest'
import { mainIngredients } from './mainIngredient'

describe('mainIngredients', () => {
  it('finds chicken, meat and fish in the ingredient lines', () => {
    expect(mainIngredients('كبسة', ['٢ كوب أرز', 'صدور دجاج مكعبات'])).toEqual(['chicken'])
    expect(mainIngredients('صينية', ['٥٠٠ جرام لحم مفروم', 'بطاطس'])).toEqual(['meat'])
    expect(mainIngredients('مقبلات', ['روبيان', 'ثوم'])).toEqual(['fish'])
    expect(mainIngredients('سلطة', ['٢ علبة تونة', 'خس'])).toEqual(['fish'])
  })

  it('finds more than one, in a fixed order', () => {
    expect(mainIngredients('مشاوي', ['لحم', 'دجاج'])).toEqual(['chicken', 'meat'])
  })

  it('does not count stock, seasoning or sauce as the thing it is made from', () => {
    expect(mainIngredients('رز بالخضار', ['٢ كوب أرز', 'ملعقة كبيرة مرق دجاج', 'مكعب ماجي دجاج', 'بهارات دجاج', 'صوص دجاج'])).toEqual([])
  })

  it('judges a recipe with no lines by its title', () => {
    expect(mainIngredients('كبسة دجاج', [])).toEqual(['chicken'])
    expect(mainIngredients('سلطة خضراء', [])).toEqual([])
  })

  it('reads a title with the kind in brackets or glued to a word', () => {
    expect(mainIngredients('رز بالفرن (دجاج مفتفت)', [])).toEqual(['chicken'])
    expect(mainIngredients('سلطة افوكادو بالدجاج', [])).toEqual(['chicken'])
    expect(mainIngredients('إيدام فاصوليا (لحم كبير أو لحم مفروم)', [])).toEqual(['meat'])
  })

  it('does not mistake other foods: eggs are not meat, and minced cheese is not minced meat', () => {
    expect(mainIngredients('شكشوكة', ['٣ بيض', 'جبن مفروم'])).toEqual([])
  })

  it('finds a protein in a line that lists several things, and ignores sentences', () => {
    expect(mainIngredients('طبق', ['لحم مفروم وبصل وثوم ومعجون طماطم'])).toEqual(['meat'])
    expect(mainIngredients('طبق', ['حطيت الدجاج في الفرن حتى ينضج جيدا ثم أخرجته'])).toEqual([])
  })
})
