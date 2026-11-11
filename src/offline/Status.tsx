// What the person sees about connection and installing: a notice while there is no connection,
// and a one-time hint to put the app on the home screen.

import { useEffect, useState } from 'react'
import { Button, Notice } from '../ui'

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

export function OfflineNotice() {
  if (useOnline()) return null
  return <Notice>لا يوجد اتصال بالإنترنت. تظهر آخر نسخة محفوظة من الوصفات، ولا يمكن التعديل أو قراءة OneNote حتى يعود الاتصال.</Notice>
}

interface InstallPrompt extends Event {
  prompt(): Promise<void>
}

const DISMISSED = 'hk-install-hint-dismissed'

const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
const isIPhone = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === '1'
  } catch {
    return false
  }
}

export function InstallHint() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [hidden, setHidden] = useState(() => isInstalled() || dismissed())

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault() // keep it for our own button
      setPrompt(event as InstallPrompt)
    }
    const onInstalled = () => setHidden(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const close = () => {
    try {
      localStorage.setItem(DISMISSED, '1')
    } catch {
      // the hint may show again next visit
    }
    setHidden(true)
  }

  if (hidden || (!prompt && !isIPhone())) return null
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 text-sm">
      <p className="font-medium">ضعي التطبيق على الشاشة الرئيسية ليفتح كتطبيق، حتى دون إنترنت.</p>
      {prompt ? (
        <div className="flex gap-2">
          <Button onClick={() => void prompt.prompt().then(close)}>ثبّتي التطبيق</Button>
          <Button kind="plain" onClick={close}>ليس الآن</Button>
        </div>
      ) : (
        <>
          <p className="text-muted">في سفاري: اضغطي زر المشاركة (المربع والسهم) ثم «إضافة إلى الشاشة الرئيسية».</p>
          <div>
            <Button kind="plain" onClick={close}>تمّ، أخفِ هذا</Button>
          </div>
        </>
      )}
    </div>
  )
}
