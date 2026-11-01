// @vitest-environment jsdom
/** Recorded security workbench results retain their saved investigation relationships. @module */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { recordSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/model.ts'
import { InvestigationGraph } from '../src/client/InvestigationGraph.tsx'
import { investigation } from '../src/client/investigation.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('projects the canonical recorded Session result with its saved relationships', () => {
  const directory = join(process.cwd(), 'snapshots/session/security-workbench')
  const filename = readdirSync(directory).filter(name => /^session(?:\.v\d+)?\.jsonl$/.test(name))
    .sort((left, right) => Number(left.match(/\.v(\d+)/)?.[1] ?? 0) - Number(right.match(/\.v(\d+)/)?.[1] ?? 0)).at(-1)
  if (!filename) throw new Error('Missing canonical security workbench Session')
  type RecordedEvent = { type: string; data: { message?: { toolCallId: string; content: { type: string; text: string }[] } } }
  const recorded = readFileSync(join(directory, filename), 'utf8').trim().split('\n')
    .map(line => JSON.parse(line) as RecordedEvent).find(event => event.type === 'tool/result' && event.data.message?.toolCallId === 'generate-security-report')
  if (!recorded?.data.message) throw new Error('Missing recorded report result')
  const result = JSON.parse(recorded.data.message.content.map(block => block.text).join('')) as { restoredProject: WorkbenchView }
  result.restoredProject.records = result.restoredProject.records.map(record => recordSchema.parse(record))
  expect(investigation(result.restoredProject).edges.map(edge => edge.relation))
    .toEqual(['graphContains', 'graphContains', 'graphContains', 'graphFollowup', 'graphFollowup'])
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  render(<InvestigationGraph renderFactorySlot={() => null} view={result.restoredProject} project="recorded" t={makeTranslate(en, common)}
    projectArtifact={vi.fn()} openChild={vi.fn()} openPlans={vi.fn()}
    activity={{ usage: [], briefs: [], connected: true, error: '', retry: vi.fn() }} />)
  expect(screen.getAllByRole('button').map(button => button.textContent)).toMatchInlineSnapshot(`
    [
      "Investigation",
      "List",
      "Expand observations",
      "Reports · Task report published; open Reports to read itRevision 1Not yet linked",
      "Materialhandler.js",
      "Materialfirmware.elf",
      "Materialtraffic.pcapng",
      "Materialunknown.bin",
      "Research direction材料侦察已导入混合材料，尚无安全结论。",
      "Research direction证据评估已导入混合材料，尚无安全结论。",
      "Research direction补充侦察已导入混合材料，尚无安全结论。",
    ]
  `)
})
