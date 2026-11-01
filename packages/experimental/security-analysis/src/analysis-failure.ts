/** Diagnostics derived from operating-system error codes, without inferred causes. @module */
import { z } from 'zod'

const systemError = z.object({ code: z.string(), message: z.string(), path: z.string().optional() })
const recovery = {
  ENOENT: { category: 'missing-path', next: 'Check the exact input and executable paths before retrying.' },
  EACCES: { category: 'permission', next: 'Check access to the named resource; do not infer antivirus quarantine.' },
  EPERM: { category: 'permission', next: 'Check the denied operation and execution permissions.' },
  ENOEXEC: { category: 'unsupported-format', next: 'Inspect the file header, architecture and selected runtime.' },
  ENOTSUP: { category: 'unsupported-operation', next: 'Check whether this environment supports the requested operation.' },
} as const

/** Add actionable diagnostics only when a structured system code establishes the failure class.
 * @param error - Failure from a filesystem or process operation.
 * @returns original failure, or an Error retaining its cause and measured code.
 */
export function analysisFailure(error: unknown): unknown {
  const parsed = systemError.safeParse(error)
  if (!parsed.success || !Object.hasOwn(recovery, parsed.data.code)) return error
  const code = z.enum(['ENOENT', 'EACCES', 'EPERM', 'ENOEXEC', 'ENOTSUP']).parse(parsed.data.code)
  return new Error(JSON.stringify({ ...parsed.data, ...recovery[code] }), { cause: error })
}
