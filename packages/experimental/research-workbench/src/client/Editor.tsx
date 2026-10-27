/** CodeMirror is loaded only when an operator opens an editable buffer. @module */
import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'

/** An editor instance owns DOM effects; draft text remains in the registration store.
 * @param props - initial document and caller-owned edits.
 * @returns the managed CodeMirror mount. */
export default function Editor({ initial, newline, label, scroll, onScroll, onChange, onSelection }: {
  initial: string
  newline: 'lf' | 'crlf' | 'mixed'
  label: string
  scroll: number
  onScroll: (position: number) => void
  onChange: (text: string) => void
  onSelection: (text: string, from: number, to: number) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onChange, onSelection, onScroll })
  callbacks.current = { onChange, onSelection, onScroll }
  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({ parent: host.current, state: EditorState.create({ doc: initial,
      extensions: [lineNumbers(), history(), highlightActiveLine(), highlightSelectionMatches(),
        EditorState.lineSeparator.of(newline === 'crlf' ? '\r\n' : '\n'),
        EditorView.domEventHandlers({ scroll: (_event, editor) => { callbacks.current.onScroll(editor.scrollDOM.scrollTop) } }),
        EditorView.contentAttributes.of({ 'aria-label': label }), keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.theme({ '&': { height: '100%', color: 'var(--dsw-alias-label-primary)', backgroundColor: 'var(--dsw-alias-bg-base)' }, '.cm-scroller': { overflow: 'auto' }, '.cm-gutters': { backgroundColor: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-secondary)', border: 'none' } }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(update.state.sliceDoc())
          if (update.selectionSet) {
            const range = update.state.selection.main
            callbacks.current.onSelection(update.state.sliceDoc(range.from, range.to),
              update.state.doc.lineAt(range.from).number, update.state.doc.lineAt(range.to).number)
          }
        })] }) })
    view.scrollDOM.scrollTop = scroll
    return () =>{  view.destroy() }
    // The document identity is the caller's key; drafts never recreate the editor.
  }, [])
  return <div ref={host} style={{ height: '100%', minHeight: 120 }} />
}
