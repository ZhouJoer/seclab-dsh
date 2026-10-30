/** Shared deferred entry for the sidebar and immutable-resource PDF views. */

/**
 * Load the package-local PDF chunk on demand.
 * @returns The PDF renderers supplied by the client module loader.
 */
export function loadPdf(): Promise<typeof import('./pdf.tsx')> {
  return import('./pdf.tsx')
}
