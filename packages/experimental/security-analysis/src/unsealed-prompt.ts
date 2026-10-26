/** Direct-execution prompt resource and its authorized-scope context entry. @module */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Read the packaged Markdown verbatim when the workbench initializes.
 * @returns complete direct-execution prompt, including its original whitespace.
 * @throws when the resource cannot be read, is empty, or lacks AUTHORIZED SCOPE.
 */
export function readUnsealedPrompt(): string {
  const path = fileURLToPath(new URL('../resources/prompts/unsealed.md', import.meta.url))
  const text = readFileSync(path, 'utf8')
  if (!text.trim()) throw new Error(`Unsealed prompt is empty: ${path}`)
  if (!text.includes('AUTHORIZED SCOPE')) throw new Error(`Unsealed prompt lacks AUTHORIZED SCOPE: ${path}`)
  return text
}

/**
 * Render the runtime-context entry that enumerates one engagement's registered scope.
 * Refreshed every turn, so registering materials or targets never disturbs the cached
 * system-prompt prefix; the direct-execution persona stays byte-identical.
 * @param scopeLines - operator-registered target descriptions, empty when none are recorded.
 * @returns the authorized-targets context text.
 */
export function unsealedScopeContext(scopeLines: readonly string[]): string {
  const scope = scopeLines.length ? scopeLines.map(line => '- ' + line).join('\n')
    : '- none recorded yet; treat every target request as out of scope until the operator registers it'
  return 'Authorized targets for this unsealed engagement. The direct-execution contract applies to exactly these:\n'
    + scope
}
