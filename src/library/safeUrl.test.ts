import { describe, expect, it } from 'vitest'
import { safeHref } from './safeUrl'

describe('safeHref', () => {
  it('keeps web addresses', () => {
    expect(safeHref('https://www.tiktok.com/@a/video/1')).toBe('https://www.tiktok.com/@a/video/1')
    expect(safeHref('  http://example.com/x ')).toBe('http://example.com/x')
  })

  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', 'not a url', '', '//evil.example'])(
    'refuses %s',
    (url) => {
      expect(safeHref(url)).toBeNull()
    },
  )
})
