// A recipe added from OneNote gets a starting set of tags, food groups and prep tasks, worked out
// from its title and ingredient lines with plain word rules (no guessing about quantities or times).
// They are only a start: the recipe waits in «مراجعة» until she approves or changes them.

import type { FoodGroup } from '../nutrition/api'
import type { TemplateInput } from '../prep/api'

export interface AutofillInput {
  title: string
  lines: string[] // the ingredient lines of the page
  text: string // the rest of the page's text (steps, notes), used when there are no ingredient lines
}

export interface Autofill {
  tags: string[]
  groups: FoodGroup[]
  prep: TemplateInput[]
}

const L = '[ء-ي]'
// Phrases that name a flavouring or a product, not the thing itself («مرق دجاج», «معجون طماطم»).
const NOT_THE_THING =
  /(مرق(ة|ه)?|مكعب(ات)?( مرق(ة)?)?|بهار(ات)?|توابل|ماجي) (ال)?(دجاج|لحم)|دبس (ال)?رمان|خل (ال)?عنب|حليب جوز هند|(بينت|بيانات) بتر|زبدة (جوز|فستق|الفول)|معجون (ال)?طماطم|صلصة (ال)?طماطم|عصير (ال)?(طماطم|برتقال|ليمون)|بشر (ال)?(برتقال|ليمون)|رب (ال)?طماطم|طماطم (مجففة|مجففه)|بودرة (ال)?بصل|بصل بودرة|كريم كراميل|كزبرة ناشفة|مسحوق|(ال)?مو(ز|ت)(ا|و)?(ز)?ر(ي|ى)?(ل|ال)(ا|ه)/g

const has = (text: string, pattern: RegExp) => pattern.test(text)
const without = (text: string) => text.toLowerCase().replace(NOT_THE_THING, ' ')

const CHICKEN = new RegExp(`(دجاج|فراخ|(^|[^ء-ي])صدر|صدور|فيليه|تشيكن|افخاذ|أفخاذ|وراك)`)
const SHREDDED = /(مفتفت|متفتف|مفتت)/
// «صدر الخروف» is lamb, not a chicken breast.
const BREASTS = new RegExp(`(^|[^ء-ي])(صدر|صدور)(?![ء-ي])(?! (ال)?(خروف|غنم|ضان|لحم|بقر))`)
const MINCED = /(لحم(ة|ه)? ?مفروم|مفروم(ة|ه)? ?مفرزن)/
const BIG_MEAT = /(لحم كبير|لحم مقطع|اوصال|أوصال|حاشي|ستيك|لحم عجل|لحم غنم|لحم بقري)/
const KOFTA = /(كفتة|كفته)/
const ANY_MEAT = new RegExp(`(^|[^ء-ي])(ال)?لحم`)
const TUNA = /(تونا|تونة|تونه)/
const SHRIMP = /(روبيان|قمبري|جمبري)/
const FISH = new RegExp(`(^|[^ء-ي])(ال)?(سمك|سمكة|سلمون|سالمون|هامور)(?!${L})`)
const QUICK = /(سريع|اسرع|أسرع|سريعة)/

// The ingredient evidence: the title and the lines, or the title and the page text when there are no lines.
const evidenceOf = (input: AutofillInput) => without(`${input.title} | ${input.lines.length ? input.lines.join(' | ') : input.text}`)

export function tagsFor(input: AutofillInput): string[] {
  const t = evidenceOf(input)
  const minced = has(t, MINCED)
  const big = has(t, BIG_MEAT)
  const kofta = has(t, KOFTA)
  const tags: string[] = []
  const chicken = has(t, CHICKEN)
  if (chicken) tags.push('دجاج')
  // Chicken breasts and shredded chicken are tags of their own, besides «دجاج».
  if (chicken && has(t, BREASTS)) tags.push('صدور دجاج')
  if (chicken && has(t, SHREDDED)) tags.push('دجاج مفتفت')
  if (minced) tags.push('لحم مفروم')
  if (big) tags.push('لحم كبير')
  if (kofta) tags.push('كفتة')
  if (has(t, ANY_MEAT) && !minced && !big && !kofta) tags.push('لحم')
  if (has(t, TUNA)) tags.push('تونا')
  if (has(t, SHRIMP)) tags.push('روبيان')
  if (has(t, FISH)) tags.push('سمك')
  if (has(`${input.title} ${input.text}`.toLowerCase(), QUICK)) tags.push('سريع')
  return tags
}

const PROTEIN = new RegExp(`(دجاج|فراخ|(^|[^ء-ي])صدر|صدور|فيليه|لحم|كفتة|كفته|ستيك|سمك|روبيان|قمبري|تونا|تونة|بروتين|شاورما)`)
const EGG = new RegExp(`بيض(ة|ات|تين)?(?!${L})`)
const CARBS = new RegExp(
  `((^|[^ء-ي])(ال)?(رز|أرز|ارز)(?!${L})|مكرونة|مكرونه|معكرونة|باستا|سباغيتي|فيتوتشيني|دقيق|طحين|خبز|توست|(^|[^ء-ي])عيش|تورتيلا|صامولي|شوفان|بطاط|شعيرية|عجينة|جلاش|بسكوت|بسكويت|كورن فليكس|اوريو|كويكر|(^|[^ء-ي])نشا(ء)?(?!${L})|قلاش|رقاق)`,
)
const VEGETABLES = new RegExp(
  `(بصل|جزر|كوس|باذ|فلفل رومي|فلفل ملون|فلفل حلو|فليفل|فلفل بارد|فلفل اخضر|فلفل أخضر|طماط|خيار|(^|[^ء-ي])(ال)?خس|بروكلي|ملفوف|فطر|مشروم|ماشروم|سبانخ|كرفس|قرع|بامية|بقدونس|كزبرة|نعناع|جرجير|ملوخية|كيل|فاصوليا خضراء|خضار|ورقيات|افوكادو|أفوكادو|شبت|ذرة|خضرة)`,
)
const FRUIT = new RegExp(
  `((^|[^ء-ي])(ال)?موز(?!${L})|(^|[^ء-ي])(ال)?موز(ت|ة)|تفاح|رمان|فراول|(^|[^ء-ي])(ال)?توت(?!${L})|(^|[^ء-ي])عنب|برتقال|(^|[^ء-ي])(ال)?تمر|مانجو|مانجا|اناناس|بطيخ|خوخ|كمثرى|فاكهة|فواكه)`,
)
const DAIRY = /(حليب|لبن|زبادي|جبن|قشطة|قشطه|كريمة|كريمه|زبدة|زبده|لبنة|كيري|موزاريلا|بارميزان|حلومي|شيدر|بشاميل|قيمر|نيدو)/

export function groupsFor(input: AutofillInput): FoodGroup[] {
  const t = evidenceOf(input)
  const eggDish = /بيض/.test(input.title)
  const found: Record<FoodGroup, boolean> = {
    vegetables: has(t, VEGETABLES),
    protein: has(t, PROTEIN) || (eggDish && has(t, EGG)),
    carbs: has(t, CARBS),
    fruit: has(t, FRUIT),
    dairy: has(t, DAIRY),
  }
  return (['vegetables', 'protein', 'carbs', 'fruit', 'dairy'] as const).filter((g) => found[g])
}

// ---- Prep tasks ----

// The vegetables worth chopping, by the name shown in the task and the words that name them.
const VEG: Array<[string, RegExp]> = [
  ['بصل أخضر', /بصل (اخضر|أخضر)/],
  ['بصل أحمر', /بصل (احمر|أحمر)/],
  ['بصل', /بصل(?! (اخضر|أخضر|احمر|أحمر))/],
  ['جزر يماني', /جزر يماني/],
  ['جزر', /جزر(?! يماني)/],
  ['طماطم كرزية', /طماطم كرزي/],
  ['طماطم', /طماط(?!م كرزي)/],
  ['فلفل رومي', /(فلفل (رومي|ملون|حلو|بارد)|فليفل)/],
  ['فلفل أخضر', /فلفل (اخضر|أخضر)(?! (حار|بارد))/],
  ['فلفل حار', /فلفل حار/],
  ['بطاطس', /بطاط/],
  ['باذنجان', /باذ/],
  ['كوسة', /كوس/],
  ['خيار', /خيار/],
  ['خس', /(^|[^ء-ي])(ال)?خس/],
  ['أفوكادو', /(افوكادو|أفوكادو)/],
  ['بقدونس', /بقدونس/],
  ['كزبرة', /كزبرة(?! ناشفة)/],
  ['نعناع', /نعناع/],
  ['ملفوف', /ملفوف/],
  ['قرع', /قرع/],
  ['فطر', /(فطر|مشروم|ماشروم)/],
  ['بامية', /بامي/],
  ['سبانخ', /سبانخ/],
  ['شبت', /شبت/],
]

const CUT = /(مفروم(?:ة|ه)? ناعم|(?:مقطع(?:ة|ه)? )?مكعبات صغير(?:ة|ه)?|(?:مقطع(?:ة|ه)? )?مكعبات|مبشور(?:ة|ه)?|شرائح|شرايح|حلقات|مفروم(?:ة|ه)?|مهروس(?:ة|ه)?|دوائر|مربعات)/

const lineClean = (line: string) => line.toLowerCase().replace(NOT_THE_THING, ' ')

// The vegetables in the lines, each with its cutting method when its own line says one.
export function vegetablesIn(lines: string[]): Array<{ name: string; cut: string | null }> {
  const cleaned = lines.map(lineClean)
  const out: Array<{ name: string; cut: string | null }> = []
  for (const [name, pattern] of VEG) {
    const own = cleaned.filter((l) => pattern.test(l))
    if (own.length === 0) continue
    // a line that names only this vegetable and a cutting method
    const alone = own.find((l) => VEG.filter(([, p]) => p.test(l)).length === 1 && CUT.test(l))
    const cut = alone ? alone.match(CUT)![1].replace(/^مقطع(?:ة|ه)? /, '').replace(/صغير(?:ة|ه)?$/, 'صغيرة').replace(/ه$/, 'ة') : null
    out.push({ name, cut })
  }
  return out
}

const MAX_BODY = 200

export function prepFor(input: AutofillInput): TemplateInput[] {
  const t = evidenceOf(input)
  const lines = input.lines.length ? input.lines : input.text.split('\n')
  const prep: TemplateInput[] = []
  const task = (kind: TemplateInput['kind'], timing: TemplateInput['timing'], body: string) => prep.push({ kind, timing, atTime: null, body: body.slice(0, MAX_BODY) })

  const chicken = has(t, CHICKEN)
  const meat = has(t, ANY_MEAT) || has(t, KOFTA)
  const shrimp = has(t, SHRIMP)
  if (chicken) task('defrost', 'morning', 'أخرجي الدجاج من الفريزر')
  if (meat) task('defrost', 'morning', 'أخرجي اللحم من الفريزر')
  if (shrimp) task('defrost', 'morning', 'أخرجي الروبيان من الفريزر')
  for (const line of input.lines) {
    if (/(مجمد|مفرزن)/.test(line) && !/ماء|مويا/.test(line)) task('defrost', 'morning', `أخرجي «${line.trim().slice(0, 80)}» من الفريزر`)
  }
  if (input.lines.some((l) => /(رز|أرز|ارز)/.test(l) && /منقوع|ينقع/.test(l))) task('other', 'before_cooking', 'انقعي الأرز')
  const labelled = lines.some((l) => /(تتبيل|تبهير|تبيل)/.test(l) && /[:：]\s*$/.test(l.trim()))
  if (labelled) {
    if (chicken) task('marinade', 'before_cooking', 'تتبيل الدجاج')
    else if (shrimp) task('marinade', 'before_cooking', 'تتبيل الروبيان')
    else if (meat) task('marinade', 'before_cooking', 'تتبيل اللحم')
  }
  const veg = vegetablesIn(lines)
  if (veg.length) task('wash_chop', 'before_cooking', `تقطيع الخضار: ${veg.map((v) => (v.cut ? `${v.name} (${v.cut})` : v.name)).join('، ')}`)
  return prep
}

export function autofillFor(input: AutofillInput): Autofill {
  return { tags: tagsFor(input), groups: groupsFor(input), prep: prepFor(input) }
}
