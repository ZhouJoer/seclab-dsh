// @vitest-environment jsdom
/** File selection and folder expansion survive immutable snapshot replacement. @module */
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { MaterialBrowserView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { MaterialBrowser } from '../src/client/MaterialBrowser.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
type Props = ComponentProps<typeof MaterialBrowser>
function props(asset = 'first'): Props {
  const useResource = (address: string) => {
    const url = new URL(address)
    const path = url.searchParams.get('path')
    const value: MaterialBrowserView = url.searchParams.get('mode') === 'file'
      ? { kind: 'text', path: path!, size: 20, text: url.pathname.includes('/first') ? '<script>not executed</script>' : 'Updated snapshot', truncated: false }
      : { kind: 'directory', entries: path === '' ? [{ kind: 'directory', path: 'src', fileCount: 1 }]
        : [{ kind: 'file', path: 'src/note.txt', size: 20 }], total: 1, next: null }
    return { status: 'live' as const, value, failure: undefined }
  }
  // This component requests only its own protocol from the generic framework hook.
  return { renderFactorySlot: () => null, project: 'task', asset, label: '/owned/workspace', directory: true,
    t: makeTranslate(en, common), useResource: useResource as Props['useResource'] }
}

it('expands directories, previews escaped text and keeps selection when materials update', async () => {
  const view = render(<MaterialBrowser {...props()} />)
  expect(screen.getByText(en.materialsSelectFile)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /note.txt/ })).toBeNull()
  fireEvent.click(screen.getByText('src'))
  fireEvent.click(await screen.findByRole('button', { name: /note.txt/ }))
  expect(screen.getByText('<script>not executed</script>')).toBeTruthy()
  expect(view.container.querySelector('script')).toBeNull()
  view.rerender(<MaterialBrowser {...props('second')} />)
  await waitFor(() => { expect(screen.getByText('Updated snapshot')).toBeTruthy() })
  expect(screen.getByRole('button', { name: /note.txt/ }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull()
  expect(view.asFragment()).toMatchSnapshot()
})
