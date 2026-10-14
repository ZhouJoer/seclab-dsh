/** Windows process status diagnostics shared by shell and executable consumers. @module */

/** Describe a recognized Windows loader status without changing the original exit code.
 * @param exitCode - signed or unsigned 32-bit process exit code, or no reported exit.
 * @returns diagnostic and recovery guidance for a recognized status; otherwise undefined.
 */
export function windowsStatusDiagnostic(exitCode: number | null): string | undefined {
  if (exitCode === null) return undefined
  switch (exitCode) {
    case -1073741515: case 3221225781:
      return 'Windows status 0xC0000135 (STATUS_DLL_NOT_FOUND): a required DLL could not be loaded. Use the installed executable with its matching DLLs; a build-tree executable may not have its runtime dependencies.'
    case -1073741701: case 3221225595:
      return 'Windows status 0xC000007B (STATUS_INVALID_IMAGE_FORMAT): an executable or dependency has an invalid image format. Check that the executable and DLL architectures match.'
    case -1073741511: case 3221225785:
      return 'Windows status 0xC0000139 (STATUS_ENTRYPOINT_NOT_FOUND): a DLL entry point was not found. Use DLLs from the same installation and version as the executable.'
    default: return undefined
  }
}
