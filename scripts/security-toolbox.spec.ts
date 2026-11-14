/** The toolbox convenience entry never invokes a container build without a reviewed plan. @module */
import { expect, it, vi } from 'vitest'
import { previewSecurityToolbox } from './security-toolbox.ts'

it('requires a configured environment and rejects unknown package groups before installation management', async () => {
  await expect(previewSecurityToolbox([])).rejects.toThrow('--environment')
  await expect(previewSecurityToolbox(['--environment', 'test', '--group', 'arbitrary-package'])).rejects.toThrow('registered Kali group')
})

it('documents preview, shared root and explicit digest-confirmed application', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await previewSecurityToolbox(['--help'])
    expect(log.mock.calls[0]?.[0]).toMatchInlineSnapshot(`
      "pnpm security:toolbox --environment ID [--group kali-web|kali-reverse|kali-firmware|kali-network] [--environments FILE] [--config FILE] [--base kalilinux/kali-last-release] [--limits FILE]
      Preview the selected Kali package group. Choose the shared root with security:tools install-root DIRECTORY, then apply the returned plan with security:tools install-apply PLAN --digest DIGEST --request-id ID [--confirm ID]. This command does not install packages or switch the selected image."
    `)
  } finally { log.mockRestore() }
})
