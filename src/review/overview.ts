// «مراجعة»: every recipe's tags, ingredients, prep tasks and food groups in one list, read live from
// the database, to check them quickly and see what is still missing. Reading only: each recipe's own
// page is where anything is changed.

import { supabase } from '../lib/supabase'
import { readThrough } from '../offline/readThrough'
import { usableIngredients, type Suggestion } from '../ingredients/api'
import { inSection } from '../library/sections'
import { KIND_LABELS, TIMING_LABELS, type PrepKind, type PrepTiming } from '../prep/api'

export interface OverviewRecipe {
  id: string
  title: string
  section: string
  custom_tags: string[]
}
interface Line {
  recipe_id: string
  position: number
  text: string
}
export interface OverviewTemplate {
  id: string
  recipe_id: string
  kind: PrepKind
  timing: PrepTiming
  at_time: string | null
  body: string
  position: number
}
export interface OverviewFlag {
  id: string
  recipe_id: string
  flag: string
  status: 'open' | 'reviewed'
}
export interface OverviewData {
  recipes: OverviewRecipe[]
  flags: OverviewFlag[]
  lines: Line[]
  suggestions: Line[] // the confirmed ones only
  templates: OverviewTemplate[]
  pages?: Array<{ recipe_id: string; web_url: string | null }> // each recipe's OneNote page, to open it from here
}

const PAGE = 1000 // the most rows one request returns

// A recipe with one of these flags still open is waiting for her to approve it: added from a OneNote
// page, given a starting set of tags, prep tasks and food groups by the app, or written as a draft
// (quantities and steps are the app's estimate) such as the starter «مفرزنات» recipes.
export const AWAITING_FLAGS = ['added_from_onenote', 'auto_filled', 'draft_by_app'] as const

type Page = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>

async function fetchAll<T>(build: (from: number, to: number) => Page): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) return out
  }
}

export const loadOverview = (): Promise<OverviewData> =>
  readThrough('overview', async () => {
    const [recipes, flags, lines, suggestions, templates, pages] = await Promise.all([
      fetchAll<OverviewRecipe>((a, b) => supabase.from('recipes').select('id,title,section,custom_tags').is('deleted_at', null).order('id').range(a, b)),
      fetchAll<OverviewFlag>((a, b) => supabase.from('recipe_flags').select('id,recipe_id,flag,status').in('flag', [...AWAITING_FLAGS]).order('id').range(a, b)),
      fetchAll<Line>((a, b) => supabase.from('recipe_ingredients').select('recipe_id,position,text').order('recipe_id').order('position').range(a, b)),
      fetchAll<Line>((a, b) => supabase.from('recipe_ingredient_suggestions').select('recipe_id,position,text').eq('status', 'confirmed').order('recipe_id').order('position').range(a, b)),
      fetchAll<OverviewTemplate>((a, b) => supabase.from('recipe_prep_templates').select('id,recipe_id,kind,timing,at_time,body,position').order('recipe_id').order('position').order('id').range(a, b)),
      fetchAll<{ recipe_id: string; web_url: string | null }>((a, b) => supabase.from('recipe_pages').select('recipe_id,web_url').order('recipe_id').range(a, b)),
    ])
    return { recipes, flags, lines, suggestions, templates, pages }
  })

// ---- Pure helpers (tested) ----

export type Problem = 'awaiting' | 'no_tags' | 'no_ingredients' | 'no_prep' | 'cut_missing'

export const PROBLEM_LABELS: Record<Problem, string> = {
  awaiting: 'تنتظر اعتمادكِ',
  no_tags: 'بلا وسوم',
  no_ingredients: 'بلا مقادير',
  no_prep: 'بلا تجهيزات',
  cut_missing: 'تقطيع بلا طريقة',
}
export const PROBLEMS = Object.keys(PROBLEM_LABELS) as Problem[]

export interface PrepItem {
  id: string
  kind: PrepKind
  timing: PrepTiming
  atTime: string | null
  label: string // «إذابة · صباحًا»
  body: string
}

export interface OverviewRow {
  id: string
  title: string
  section: string
  tags: string[]
  ingredients: string[]
  ingredientsFromApp: boolean // the lines are the ones she confirmed in the app, not the page's
  prep: PrepItem[]
  uncut: string[] // vegetables in a chopping task that have no cutting method next to them
  awaiting: string[] // the open flags that keep it waiting for approval
  approved: boolean // she approved it: it is done, so it carries no problems and leaves the working list
  pageUrl: string | null // its OneNote page, where the ingredients are edited
  problems: Problem[]
}

const CHOP_PREFIX = 'تقطيع الخضار:'

// The vegetables of a chopping task («تقطيع الخضار: بصل (مفروم)، جزر») that have no «(طريقة)» beside them.
export function uncutVegetables(body: string): string[] {
  if (!body.trim().startsWith(CHOP_PREFIX)) return []
  const list = body.trim().slice(CHOP_PREFIX.length)
  // split at the commas that are not inside a bracket («بطاطس (شرائح، مسلوقة)»)
  return list
    .split(/،\s*(?![^()]*\))/)
    .map((item) => item.trim())
    .filter((item) => item && !item.includes('('))
}

export function buildOverview(data: OverviewData): OverviewRow[] {
  const by = <T extends { recipe_id: string }>(rows: T[]) => {
    const map = new Map<string, T[]>()
    for (const row of rows) map.set(row.recipe_id, [...(map.get(row.recipe_id) ?? []), row])
    return map
  }
  const lines = by(data.lines)
  const suggestions = by(data.suggestions)
  const templates = by(data.templates)
  const flags = by(data.flags)
  const pageUrls = new Map((data.pages ?? []).map((p) => [p.recipe_id, p.web_url]))

  return data.recipes.map((recipe) => {
    const written = (lines.get(recipe.id) ?? []).sort((a, b) => a.position - b.position).map((l) => l.text)
    const confirmed = (suggestions.get(recipe.id) ?? []).map((s) => ({ status: 'confirmed', position: s.position, text: s.text }) as Suggestion)
    const used = usableIngredients(written, confirmed)
    const tasks = (templates.get(recipe.id) ?? []).sort((a, b) => a.position - b.position)
    const uncut = tasks.flatMap((t) => uncutVegetables(t.body))
    const tags = recipe.custom_tags ?? []
    const theirFlags = (flags.get(recipe.id) ?? []).filter((f) => (AWAITING_FLAGS as readonly string[]).includes(f.flag))
    const awaiting = theirFlags.filter((f) => f.status === 'open').map((f) => f.id)
    const approved = awaiting.length === 0 && theirFlags.length > 0
    const problems: Problem[] = []
    if (awaiting.length > 0) problems.push('awaiting')
    if (tags.length === 0) problems.push('no_tags')
    if (used.lines.length === 0) problems.push('no_ingredients')
    if (tasks.length === 0) problems.push('no_prep')
    if (uncut.length > 0) problems.push('cut_missing')
    return {
      id: recipe.id,
      title: recipe.title,
      section: recipe.section,
      tags,
      ingredients: used.lines,
      ingredientsFromApp: used.from === 'app',
      prep: tasks.map((t) => ({ id: t.id, kind: t.kind, timing: t.timing, atTime: t.at_time, label: `${KIND_LABELS[t.kind]} · ${TIMING_LABELS[t.timing]}`, body: t.body })),
      uncut,
      awaiting,
      approved,
      pageUrl: pageUrls.get(recipe.id) ?? null,
      problems: approved ? [] : problems,
    }
  })
}

export interface Filters {
  query: string
  section: string | null
  problem: Problem | 'approved' | null
  tag: string | null
}

const norm = (text: string) => text.replace(/[ً-ٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase().trim()

export function filterRows(rows: OverviewRow[], f: Filters): OverviewRow[] {
  const q = norm(f.query)
  // the working list leaves out the recipes she approved, unless she asks for them or searches
  const approvedToo = f.problem === 'approved' || q !== ''
  return rows.filter(
    (r) =>
      (f.problem === 'approved' ? r.approved : approvedToo || !r.approved) &&
      (!f.section || inSection(r.section, f.section)) &&
      (!f.problem || f.problem === 'approved' || r.problems.includes(f.problem)) &&
      (!f.tag || r.tags.includes(f.tag)) &&
      (!q || norm(r.title).includes(q) || r.tags.some((t) => norm(t).includes(q))),
  )
}

export function problemCounts(rows: OverviewRow[]): Array<[Problem, number]> {
  return PROBLEMS.map((p) => [p, rows.filter((r) => r.problems.includes(p)).length] as [Problem, number])
}
