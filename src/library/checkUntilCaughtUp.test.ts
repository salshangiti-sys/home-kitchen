import { describe, expect, it, vi } from 'vitest'
import { checkUntilCaughtUp, type CheckSummary } from './onenote'

const run = (refreshed: number, waiting?: number): CheckSummary => ({ pages: 30, unlinked: 0, missing: [], refreshed, changed: refreshed, waiting })

describe('checking the notebook until the edited pages are read', () => {
  it('asks again while pages wait, and adds up what was read', async () => {
    const check = vi.fn().mockResolvedValueOnce(run(5, 7)).mockResolvedValueOnce(run(5, 2)).mockResolvedValueOnce(run(2, 0))
    const total = await checkUntilCaughtUp(check)
    expect(check).toHaveBeenCalledTimes(3)
    expect(total).toMatchObject({ refreshed: 12, changed: 12, waiting: 0 })
  })

  it('stops after one run when nothing waits, or when an older function does not say', async () => {
    const none = vi.fn().mockResolvedValue(run(3, 0))
    await checkUntilCaughtUp(none)
    expect(none).toHaveBeenCalledTimes(1)
    const old = vi.fn().mockResolvedValue(run(3))
    await checkUntilCaughtUp(old)
    expect(old).toHaveBeenCalledTimes(1)
  })

  it('does not loop when a run made no progress, and never more than the rounds given', async () => {
    const stuck = vi.fn().mockResolvedValueOnce(run(5, 4)).mockResolvedValue(run(0, 4))
    await checkUntilCaughtUp(stuck)
    expect(stuck).toHaveBeenCalledTimes(2)
    const endless = vi.fn().mockResolvedValue(run(5, 99))
    await checkUntilCaughtUp(endless, 3)
    expect(endless).toHaveBeenCalledTimes(3)
  })
})
