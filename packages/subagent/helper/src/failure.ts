/** Automatic consultation failures whose child cleanup has completed. @module */

/** A consultation failed; no child remains running after this error reaches the caller. */
export class AutomaticConsultationFailure extends Error {
  /**
   * @param cause Provider or activation failure retained for host diagnostics.
   */
  constructor(cause: unknown) {
    super('Automatic Advisor consultation failed. Continue with the available evidence or consult Advisor manually.', { cause })
  }
}
