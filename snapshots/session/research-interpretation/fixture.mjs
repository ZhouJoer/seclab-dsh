/** In-memory observations and a bounded executor around the real review plugin. */
import assert from 'node:assert/strict'
import { Service } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'research-interpretation-fixture'
export const inject = ['tools']
const output = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
const commands = new Map([
  ['python -X utf8 -c "print([2,4,6]) # D:/snapshot-analysis/input.bin"', [2, 4, 6]],
  ['python -c "print([2,4,6,7,9]) # D:/snapshot-analysis/input.bin"', [2, 4, 6, 7, 9]],
])

class FixtureWorkbench extends Service {
  constructor(ctx) { super(ctx, 'securityWorkbench') }
  getAnalysisPhase() { return 'exploring' }
  async view() { return { revision: 0, records: [] } }
}

/** Register deterministic inputs; no command is passed to an operating-system shell. */
export function apply(ctx) {
  const now = Date.now
  Date.now = () => 1800000000000
  ctx.effect(() => () => { Date.now = now })
  ctx.plugin(FixtureWorkbench)
  ctx.tools.register(defineTool({ name: 'native_observe', description: 'Read the complete synthetic integer dataset.',
    parameters: { path: { type: 'string', required: true } }, output,
    execute(args) {
      assert.equal(args.path, 'D:/snapshot-analysis/input.bin')
      return { evidenceId: 'fixture-evidence', operation: 'fixture.records', incomplete: false,
        items: [{ values: [2, 4, 6, 7, 9], count: 5 }] }
    } }))
  ctx.tools.register(defineTool({ name: 'pwsh', description: 'Run a recorded synthetic measurement without starting a process.',
    parameters: { command: { type: 'string', required: true }, workdir: { type: 'string', required: true } }, output,
    execute(args) {
      assert.equal(args.workdir, 'D:/snapshot-analysis')
      const values = commands.get(args.command)
      assert(values, 'The dependent exclusion must remain paused before execution')
      return { kind: 'foreground', exitCode: 0, signal: null, timedOut: false, aborted: false,
        stdout: { text: JSON.stringify(values), truncated: false }, stderr: { text: '', truncated: false } }
    } }))
}
