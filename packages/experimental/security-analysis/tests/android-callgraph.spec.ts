/** Native JADX graph IDs cannot be replaced by same-name text matches. @module */
import { expect, it } from 'vitest'
import { jadxCallgraphItems } from '../src/android-callgraph.ts'
import { parseAdapterParameters } from '../src/tool-adapter-provider.ts'

it('preserves overload descriptors and method locations without inventing call sites', () => {
  const files = [{ path: 'callgraph.json', text: JSON.stringify({ nodes: [
    { id: 1, method: 'app.Api.login(I)V' }, { id: 2, method: 'app.Api.login(Ljava/lang/String;)V' },
  ], edges: [{ from: 1, to: 2, resolved: true }] }) }, { path: 'sources/app/Api.json', text: JSON.stringify({ name: 'app.Api',
    methods: [{ signature: 'login(I)V', declaration: 'void login(int n)', lines: [{ code: 'login("test");', 'source-line': 10, offset: '0x32' }] }] }) }]
  expect(jadxCallgraphItems(files)).toContainEqual({ kind: 'call', from: 'app.Api.login(I)V', to: 'app.Api.login(Ljava/lang/String;)V',
    resolved: true, basis: 'jadx-callgraph', path: 'callgraph.json', callSite: null })
  expect(jadxCallgraphItems(files).at(-1)).toMatchObject({ method: 'app.Api.login(I)V', lines: [{ sourceLine: 10, offset: '0x32' }] })
  expect(() => jadxCallgraphItems([])).toThrow('missing')
  expect(() => jadxCallgraphItems([{ path: 'callgraph.json', text: '{"nodes":[],"edges":[{"from":1,"to":2,"resolved":true}]}' }])).toThrow('absent')
})

it('requires bounded semantic graph queries and rejects executable parameters', () => {
  expect(() => parseAdapterParameters('analysis.native-xref-paths', { evidenceIds: ['e'], seed: '0x1;!cmd', direction: 'callers', maxDepth: 3 })).toThrow()
  expect(() => parseAdapterParameters('analysis.android-callchain', { evidenceIds: ['e'] })).toThrow('requires')
  expect(() => parseAdapterParameters('jadx.callgraph', { className: 'A' })).toThrow('Unsupported')
  expect(parseAdapterParameters('analysis.android-callchain', { evidenceIds: ['e'], seed: 'a.b()V', direction: 'callers', maxDepth: 3 }).seed).toBe('a.b()V')
})
