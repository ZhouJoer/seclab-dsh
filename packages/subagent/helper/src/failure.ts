/** Advisor prompt compatibility and settled automatic consultation failures. @module */

/** A system-prompt override removed the required role of a tool-free API adviser. */
export class AdvisorPromptConflictError extends Error {
  /** The configured prompt prevented the tool-free role from reaching the adviser. */
  readonly code = 'ADVISOR_PROMPT_CONFLICT'

  constructor() {
    super('Tool-free Advisor requires its final system role. Use composable system sections instead of a complete system prompt or an assembly override that removes the Advisor role.')
  }
}

/** A consultation failed; no child remains running after this error reaches the caller. */
export class AutomaticConsultationFailure extends Error {
  /**
   * @param cause Provider or activation failure retained for host diagnostics.
   */
  constructor(cause: unknown) {
    super(cause instanceof AdvisorOutputError ? cause.message
      : 'Automatic Advisor consultation failed. Continue with the available evidence or consult Advisor manually.', { cause })
  }
}

/** A settled adviser did not deliver complete, nonempty text. Partial output remains in its child log. */
export class AdvisorOutputError extends Error {
  /** Stable identity for callers that report incomplete advice. */
  readonly code = 'ADVISOR_OUTPUT_INCOMPLETE'

  /**
   * @param reason Recorded termination or empty-output reason.
   * @param recoveryAttempted Whether a bounded delivery turn was already attempted.
   */
  constructor(readonly reason: string, readonly recoveryAttempted: boolean) {
    super(`Advisor did not deliver a complete answer (${reason}${recoveryAttempted ? '; delivery recovery exhausted' : ''}). Partial output is not verified advice; inspect the child record and continue with an executable check.`)
  }
}
