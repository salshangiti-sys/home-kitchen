// Keeps what she taught the dictionary loaded for the whole app. The catalog reads it directly (so
// every screen that groups ingredient lines uses it), and screens that show grouped lines read the
// version number from here so they work their lists out again when the lessons change.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { setLessons } from './catalog'
import { loadLessons } from './lessons'

const Context = createContext<{ version: number; reload: () => void }>({ version: 0, reload: () => undefined })

export function LessonsProvider({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  const [version, setVersion] = useState(0)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!signedIn) {
      setLessons([])
      return
    }
    let cancelled = false
    loadLessons().then(
      (lessons) => {
        if (cancelled) return
        setLessons(lessons)
        setVersion((v) => v + 1)
      },
      () => undefined, // no lessons yet: the dictionary alone
    )
    return () => {
      cancelled = true
    }
  }, [signedIn, tick])

  const value = useMemo(() => ({ version, reload }), [version, reload])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export const useLessonsVersion = () => useContext(Context).version
export const useReloadLessons = () => useContext(Context).reload
