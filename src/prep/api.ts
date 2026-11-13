// Prep tasks ("مهام التجهيز"): what a recipe needs before cooking (templates, written by owners and
// editors), the tasks made from them for the meals in the plan, and tasks added by hand. Everyone in
// the household can tick a task; only owners and editors make or change them (see the prep_tasks
// migration). The app never makes up durations: a suggestion only offers a template to add.

import { supabase } from '../lib/supabase'
import { explain, looksOffline, readThrough } from '../offline/readThrough'
import { normalizeAr } from '../library/normalize'
import { addDays } from '../plan/dates'

export type PrepKind = 'defrost' | 'wash_chop' | 'marinade' | 'sauce' | 'other'
export type PrepTiming = 'night_before' | 'morning' | 'before_cooking' | 'at_time'

export const KINDS: PrepKind[] = ['defrost', 'wash_chop', 'marinade', 'sauce', 'other']
export const TIMINGS: PrepTiming[] = ['night_before', 'morning', 'before_cooking', 'at_time']

export const KIND_LABELS: Record<PrepKind, string> = {
  defrost: 'إذابة',
  wash_chop: 'غسل وتقطيع',
  marinade: 'بهارات وتتبيلة',
  sauce: 'صوص',
  other: 'أخرى',
}

export const TIMING_LABELS: Record<PrepTiming, string> = {
  night_before: 'الليلة السابقة',
  morning: 'صباحًا',
  before_cooking: 'قبل الطبخ',
  at_time: 'في وقت محدد',
}

export interface Template {
  id: string
  recipe_id: string
  kind: PrepKind
  timing: PrepTiming
  at_time: string | null // 'HH:MM:SS'
  body: string
  position: number
}

export interface Task {
  id: string
  planned_meal_id: string | null
  day: string
  timing: PrepTiming
  at_time: string | null
  kind: PrepKind
  body: string
  from_template: boolean
  done_at: string | null
  done_by: string | null
  position: number
}

export interface MealInfo {
  title: string
  day: string
  slot: string
}

export interface NowData {
  tasks: Task[]
  meals: Record<string, MealInfo>
}

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}

export const listTemplates = (recipeId: string): Promise<Template[]> =>
  readThrough(`prep-templates:${recipeId}`, async () => {
    const { data, error } = await supabase.from('recipe_prep_templates').select('id,recipe_id,kind,timing,at_time,body,position').eq('recipe_id', recipeId).order('position').order('id')
    fail(error)
    return data as Template[]
  })

// Open tasks of the last 14 days (the late ones) up to tomorrow, and the ones done on those days.
export const loadNow = (today: string): Promise<NowData> =>
  readThrough(`prep-now:${today}`, async () => {
    const { data, error } = await supabase
      .from('prep_tasks')
      .select('id,planned_meal_id,day,timing,at_time,kind,body,from_template,done_at,done_by,position')
      .is('dismissed_at', null)
      .gte('day', addDays(today, -14))
      .lte('day', addDays(today, 1))
      .order('day')
      .order('position')
    fail(error)
    const tasks = data as Task[]
    const ids = [...new Set(tasks.flatMap((t) => (t.planned_meal_id ? [t.planned_meal_id] : [])))]
    const meals: Record<string, MealInfo> = {}
    if (ids.length) {
      const [m, s] = await Promise.all([
        supabase.from('planned_meals').select('id,title,day,slot_id').in('id', ids),
        supabase.from('meal_slots').select('id,name'),
      ])
      fail(m.error)
      fail(s.error)
      const slots = new Map((s.data as Array<{ id: string; name: string }>).map((x) => [x.id, x.name]))
      for (const row of m.data as Array<{ id: string; title: string; day: string; slot_id: string }>) meals[row.id] = { title: row.title, day: row.day, slot: slots.get(row.slot_id) ?? '' }
    }
    return { tasks, meals }
  })

async function rpc<T = void>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  fail(error)
  return data as T
}

export interface TemplateInput {
  kind: PrepKind
  timing: PrepTiming
  atTime: string | null
  body: string
}
export const saveTemplate = (id: string | null, recipeId: string, t: TemplateInput) =>
  rpc<string>('save_prep_template', { p_id: id, p_recipe_id: recipeId, p_kind: t.kind, p_timing: t.timing, p_at_time: t.atTime, p_body: t.body })
export const removeTemplate = (id: string) => rpc('remove_prep_template', { p_id: id })
export const generateTasks = (day: string) => rpc<{ added: number; updated: number; removed: number }>('generate_prep_tasks', { p_day: day })

export interface TaskInput {
  day: string
  timing: PrepTiming
  atTime: string | null
  body: string
}
export const addTask = (t: TaskInput, kind: PrepKind = 'other', meal: string | null = null) =>
  rpc('add_prep_task', { p_day: t.day, p_timing: t.timing, p_at_time: t.atTime, p_kind: kind, p_body: t.body, p_meal: meal })
export const updateTask = (id: string, t: TaskInput) => rpc('update_prep_task', { p_id: id, p_day: t.day, p_timing: t.timing, p_at_time: t.atTime, p_body: t.body })
export const dismissTask = (id: string) => rpc('dismiss_prep_task', { p_id: id })
export const setDone = (id: string, done: boolean) => rpc('set_task_done', { p_id: id, p_done: done })

const MESSAGES: Array<[RegExp, string]> = [
  [/bad_timing/, 'اختاري وقتًا محددًا فقط حين يكون التوقيت «في وقت محدد».'],
  [/recipe not found or in the trash/, 'الوصفة غير موجودة أو في سلة المحذوفات.'],
  [/check constraint|body/i, 'نص المهمة من 1 إلى 200 حرف.'],
  [/not allowed|42501/i, 'لا تملكين صلاحية تعديل المهام.'],
]

export function prepMessage(error: unknown): string {
  if (looksOffline(error)) return explain(error).message
  const text = error instanceof Error ? error.message : String(error)
  return MESSAGES.find(([pattern]) => pattern.test(text))?.[1] ?? text
}

// ---- Pure helpers (tested) ----

// 'HH:MM:SS' from the database to 'HH:MM' for showing and for a time input.
export const shortTime = (time: string | null) => (time ? time.slice(0, 5) : null)

const RANK: Record<PrepTiming, number> = { morning: 1, at_time: 2, before_cooking: 3, night_before: 4 }

// Within a day: morning, then the timed ones in time order, then before cooking, then the evening
// ("tonight") ones for tomorrow's meal.
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      RANK[a.timing] - RANK[b.timing] ||
      (a.at_time ?? '').localeCompare(b.at_time ?? '') ||
      a.position - b.position ||
      a.id.localeCompare(b.id),
  )
}

export interface NowGroups {
  overdue: Task[]
  today: Task[]
  tomorrow: Task[]
  doneToday: Task[]
}

export function groupNow(tasks: Task[], today: string): NowGroups {
  const tomorrow = addDays(today, 1)
  const open = (t: Task) => t.done_at === null
  return {
    overdue: sortTasks(tasks.filter((t) => open(t) && t.day < today)),
    today: sortTasks(tasks.filter((t) => open(t) && t.day === today)),
    tomorrow: sortTasks(tasks.filter((t) => open(t) && t.day === tomorrow)),
    doneToday: sortTasks(tasks.filter((t) => !open(t) && t.day === today)),
  }
}

export interface Suggestion {
  line: string
  kind: PrepKind
  timing: PrepTiming
  body: string
}

const FROZEN = /مجمد/
const FREEZER_SHAPES = /مفروم|صدور|صدر|شرائح|فيليه|ستيك/
const FREEZER_ITEMS = /لحم|لحمه|دجاج|ضان|بقر|سمك|روبيان|جمبري|ديك رومي|كفته/

// Ingredient lines that may need taking out of the freezer: a line that says "frozen", or minced /
// breasts / fillets of meat, chicken or fish. A suggestion only: nothing is added unless the person
// adds it, and no duration is ever invented.
export function suggestPrep(lines: string[]): Suggestion[] {
  const out: Suggestion[] = []
  const seen = new Set<string>()
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || seen.has(line)) continue
    const norm = normalizeAr(line)
    if (FROZEN.test(norm) || (FREEZER_SHAPES.test(norm) && FREEZER_ITEMS.test(norm))) {
      seen.add(line)
      out.push({ line, kind: 'defrost', timing: 'night_before', body: `أخرجي «${line.length > 80 ? `${line.slice(0, 80)}…` : line}» من الفريزر` })
    }
  }
  return out
}
