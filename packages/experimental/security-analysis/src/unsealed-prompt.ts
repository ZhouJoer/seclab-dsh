/** Sealed direct-execution persona and its authorized-scope context entry. @module */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { deflateSync, inflateSync } from 'node:zlib'

/**
 * Domain separation for the sealed contract slot. The derived key ships with the
 * package, so sealing provides tamper-evidence and static-extraction resistance,
 * never secrecy; the assembled prompt stays model-visible and session-logged.
 */
const MIX = Object.freeze(['security.unsealed.v1', 'dsh-experimental-security-analysis', 'slot:direct-contract'])
const mixKey = (mask: string) => createHash('sha256').update(`${MIX.join('\x1e')}\x1e${mask}`).digest()

/** Sealed slot fields embedded in the generated slot module. */
export interface SealedSlot {
  /** Deflated AES-256-GCM ciphertext, base64. */
  SLOT: string
  /** Random per-generation mask mixed into the key, base64. */
  MASK: string
  /** GCM authentication tag, base64. */
  TAG: string
  /** GCM initialization vector, base64. */
  IV: string
}

/**
 * Seal the contract source during generation.
 * @param text - complete contract markdown from resources/prompts/unsealed.md.
 * @returns sealed slot fields for the generated module.
 */
export function sealUnsealedPrompt(text: string): SealedSlot {
  const mask = randomBytes(16).toString('base64')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', mixKey(mask), iv)
  const packed = deflateSync(Buffer.from(text, 'utf8'), { level: 9 })
  const body = Buffer.concat([cipher.update(packed), cipher.final()])
  return {
    SLOT: body.toString('base64'),
    MASK: mask,
    TAG: cipher.getAuthTag().toString('base64'),
    IV: iv.toString('base64'),
  }
}

/**
 * Open and verify one sealed slot.
 * @param slot - sealed fields from the generated slot module.
 * @returns the contract markdown.
 * @throws when authentication fails; a tampered slot must fail loudly instead of injecting degraded text.
 */
export function openUnsealedPrompt(slot: SealedSlot): string {
  try {
    const decipher = createDecipheriv('aes-256-gcm', mixKey(slot.MASK), Buffer.from(slot.IV, 'base64'))
    decipher.setAuthTag(Buffer.from(slot.TAG, 'base64'))
    return inflateSync(Buffer.concat([decipher.update(Buffer.from(slot.SLOT, 'base64')), decipher.final()])).toString('utf8')
  } catch (error) {
    throw new Error('Sealed unsealed-prompt slot failed verification: '
      + (error instanceof Error ? error.message : String(error)))
  }
}

/**
 * Render the runtime-context entry that enumerates one engagement's registered scope.
 * Refreshed every turn, so registering materials or targets never disturbs the cached
 * system-prompt prefix; the sealed persona stays byte-identical.
 * @param scopeLines - operator-registered target descriptions, empty when none are recorded.
 * @returns the authorized-targets context text.
 */
export function unsealedScopeContext(scopeLines: readonly string[]): string {
  const scope = scopeLines.length ? scopeLines.map(line => '- ' + line).join('\n')
    : '- none recorded yet; treat every target request as out of scope until the operator registers it'
  return 'Authorized targets for this unsealed engagement. The direct-execution contract applies to exactly these:\n'
    + scope
}
