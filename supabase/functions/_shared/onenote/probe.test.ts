import { describe, expect, it } from 'vitest'
import { parseHTML } from 'linkedom'
import { buildRtlProbePages } from './probe.ts'

describe('RTL probe page (round 2)', () => {
  const [page] = buildRtlProbePages()
  const { document } = parseHTML(page.html)

  it('labels all three variants in their own data-id div', () => {
    expect(document.querySelectorAll('[data-id^="probe-"]').length).toBe(3)
    const text = document.body.textContent ?? ''
    for (const label of ['ز)', 'ح)', 'ط)']) expect(text).toContain(label)
  })

  it('wraps every line in a balanced bidi control pair', () => {
    for (const el of Array.from(document.querySelectorAll('p, li, h2'))) {
      const text = (el as unknown as { textContent: string }).textContent
      const opensEmbed = text.startsWith('‫') && text.endsWith('‬')
      const opensIsolate = text.startsWith('⁧') && text.endsWith('⁩')
      expect(opensEmbed || opensIsolate).toBe(true)
    }
  })
})
