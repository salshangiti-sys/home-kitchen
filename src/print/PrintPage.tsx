// The week plan as a page to print or save as PDF from the browser's print dialog (HTML and CSS, so
// the Arabic font and right-to-left layout are the ones the app already uses). Two versions: meals
// only, and meals with each day's prep tasks. The buttons and the app's menus are left out of the print.

import { useEffect, useMemo, useState } from 'react'
import { href } from '../router'
import { Button, LinkButton, Notice } from '../ui'
import * as plan from '../plan/api'
import { dayLabel, isIsoDate, todayIso, weekRange, weekdayName } from '../plan/dates'
import * as prep from '../prep/api'
import { buildPrintWeek, type PrintDay } from './model'

export interface PrintApi {
  loadWeek: typeof plan.loadWeek
  loadWeekTasks: typeof prep.loadWeekTasks
}

const realApi: PrintApi = { loadWeek: plan.loadWeek, loadWeekTasks: prep.loadWeekTasks }

interface Props {
  week?: string
  withTasks: boolean
  today?: () => string
  api?: PrintApi
  print?: () => void
}

function Box({ done }: { done: boolean }) {
  // A drawn box, not a character: no font has to supply it.
  return <span aria-hidden="true" className={`mt-1 inline-block size-3.5 shrink-0 rounded-sm border border-ink ${done ? 'bg-ink' : ''}`} />
}

function Tasks({ day }: { day: PrintDay }) {
  if (day.tasks.length === 0) return null
  return (
    <div className="mt-2">
      <h4 className="text-sm font-semibold">التجهيز</h4>
      <ul className="mt-1 flex flex-col gap-1">
        {day.tasks.map((task) => (
          <li key={task.id} className="flex items-start gap-2 text-sm">
            <Box done={task.done} />
            <span dir="auto">
              <span className="text-muted">{task.when}: </span>
              <span className={task.done ? 'line-through' : ''}>{task.body}</span>
              {task.meal && <span className="text-muted"> ({task.meal})</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function PrintPage({ week, withTasks, today = todayIso, api = realApi, print = () => window.print() }: Props) {
  const anyDay = isIsoDate(week) ? week : today()
  const [data, setData] = useState<{ week: plan.WeekData; tasks: prep.NowData | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    setTaskError(null)
    void (async () => {
      try {
        const weekData = await api.loadWeek(anyDay)
        let tasks: prep.NowData | null = null
        if (withTasks) {
          try {
            tasks = await api.loadWeekTasks(weekData.weekStart)
          } catch (e) {
            if (!cancelled) setTaskError(prep.prepMessage(e))
          }
        }
        if (!cancelled) setData({ week: weekData, tasks })
      } catch (e) {
        if (!cancelled) setError(plan.planMessage(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api, anyDay, withTasks])

  const model = useMemo(
    () => (data ? buildPrintWeek({ weekStart: data.week.weekStart, slots: data.week.slots, people: data.week.people, meals: data.week.meals, tasks: data.tasks?.tasks ?? null, taskMeals: data.tasks?.meals }) : null),
    [data],
  )

  if (!data || !model) return error ? <Notice tone="error">{error}</Notice> : <p className="text-muted">جارٍ التحميل…</p>

  const weekStart = data.week.weekStart
  const nothing = data.week.meals.every((m) => m.status === 'skipped')
  const showingTasks = withTasks && data.tasks !== null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 print:hidden">
        <h2 className="text-2xl font-bold">طباعة الخطة</h2>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={href.print(weekStart, false)} kind={withTasks ? 'plain' : 'primary'}>الوجبات فقط</LinkButton>
          <LinkButton href={href.print(weekStart, true)} kind={withTasks ? 'primary' : 'plain'}>الوجبات مع التجهيز</LinkButton>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={print}>اطبعي</Button>
          <LinkButton href={href.plan(weekStart)}>← رجوع إلى الخطة</LinkButton>
        </div>
        <p className="text-sm text-muted">لحفظها ملفًّا: اختاري «حفظ كـ PDF» من نافذة الطباعة.</p>
        {error && <Notice tone="error">{error}</Notice>}
        {taskError && <Notice tone="error">تعذّر تحميل مهام التجهيز ({taskError})، فالصفحة أدناه بالوجبات فقط.</Notice>}
        {nothing && <Notice>لا وجبات في هذا الأسبوع بعد.</Notice>}
      </div>

      <article aria-label="الخطة المطبوعة" className="flex flex-col gap-3">
        <header>
          <h1 className="text-2xl font-bold">خطة الأسبوع</h1>
          <p className="text-muted">{weekRange(weekStart)}</p>
        </header>

        {showingTasks && model.before && (
          <section aria-label="قبل بداية الأسبوع" className="break-inside-avoid rounded-xl border border-line p-3">
            <h3 className="text-lg font-semibold">
              {weekdayName(model.before.day)} <span className="text-sm font-normal text-muted">{dayLabel(model.before.day)} (قبل بداية الأسبوع)</span>
            </h3>
            <Tasks day={model.before} />
          </section>
        )}

        {model.days.map((day) => (
          <section key={day.day} aria-label={`${weekdayName(day.day)} ${dayLabel(day.day)}`} className="break-inside-avoid rounded-xl border border-line p-3">
            <h3 className="text-lg font-semibold">
              {weekdayName(day.day)} <span className="text-sm font-normal text-muted">{dayLabel(day.day)}</span>
            </h3>
            {day.slots.length === 0 ? (
              <p className="text-sm text-muted">—</p>
            ) : (
              <dl className="mt-1 flex flex-col gap-1">
                {day.slots.map((slot) => (
                  <div key={slot.name} className="flex gap-2 text-base">
                    <dt className="w-16 shrink-0 font-semibold">{slot.name}</dt>
                    <dd className="flex-1">
                      {slot.meals.map((meal) => (
                        <p key={meal.id} dir="auto">
                          {meal.title}
                          {(meal.servings !== null || meal.people.length > 0) && (
                            <span className="text-sm text-muted">
                              {' '}
                              ({[meal.servings !== null ? `${meal.servings} ${meal.servings === 1 ? 'حصة' : 'حصص'}` : null, meal.people.length ? meal.people.join('، ') : null].filter(Boolean).join(' — ')})
                            </span>
                          )}
                        </p>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {showingTasks && <Tasks day={day} />}
          </section>
        ))}
        <footer className="text-xs text-muted">طُبعت يوم {weekdayName(today())} {dayLabel(today())}</footer>
      </article>
    </div>
  )
}
