/** Configured preference choices shared by the intake and editor tests. @module */
import type { ToolPreferenceOptions } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { builtinToolPack } from '../../security-analysis/src/builtin-tools.ts'

/** Radare2 and TShark are configured; script-only tools cannot be selected. */
export const preferenceOptions: ToolPreferenceOptions = {
  tools: builtinToolPack.tools.map(({ id, label, tags }) => ({ id, label, tags,
    ...(['radare2', 'tshark'].includes(id) ? {} : { unavailable: 'adapter' as const }) })),
  collections: builtinToolPack.collections.map(group => ({ ...group,
    toolIds: group.toolIds.filter(id => ['radare2', 'tshark'].includes(id)) })),
}
