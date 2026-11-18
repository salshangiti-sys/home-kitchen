import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnlinkedRow } from './OneNotePage'

afterEach(cleanup)

const page = { page_id: 'p9', title: 'TEST-C', section_name: 'مفرزنات', web_url: 'https://onenote.example/p9' }

describe('a page that is not in the app yet (the OneNote page)', () => {
  it('can be ignored when it is not a recipe', async () => {
    const ignore = vi.fn(async () => undefined)
    const act = vi.fn(async (work: () => Promise<string | void>) => void (await work()))
    render(
      <ul>
        <UnlinkedRow page={page} recipes={[]} busy={false} act={act} ignore={ignore} />
      </ul>,
    )
    expect(screen.getByRole('button', { name: 'أضيفيها كوصفة' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'تجاهلي، ليست وصفة' }))
    await waitFor(() => expect(ignore).toHaveBeenCalledWith('p9'))
    expect(act).toHaveBeenCalledTimes(1)
  })

  it('cannot be ignored while something else is running', () => {
    render(
      <ul>
        <UnlinkedRow page={page} recipes={[]} busy act={async () => undefined} ignore={async () => undefined} />
      </ul>,
    )
    expect((screen.getByRole('button', { name: 'تجاهلي، ليست وصفة' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
