/** Local Jev decision endpoint for shipped-profile replay. */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { text } from 'node:stream/consumers'

const decision = { model: 'jev-fixture', answers: { route: {
  type: 'choice', choice: 'consult_advisor', confidence: 0.99,
  probabilities: { continue: 0, consult_advisor: 1, insufficient_evidence: 0, external_blocker: 0 },
} }, usage: { input_tokens: 100, output_tokens: 10 } }

/** Start an isolated loopback endpoint; callers must close it after the subprocess settles. */
export async function startJevFixture(body: unknown = decision) {
  const requests: string[] = []
  const received = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const pending = new Set<Promise<void>>()
  const server = createServer((request, response) => {
    const serve = async () => {
      requests.push(await text(request))
      received.resolve(undefined)
      if (body === 'wait') await release.promise
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(body === 'wait' ? decision : body))
    }
    const operation = serve().catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error)))
    })
    pending.add(operation)
    void operation.finally(() => { pending.delete(operation) })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests, received, release,
    close: async () => {
      release.resolve(undefined)
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error) reject(error)
        else resolve()
      }))
      await Promise.all([...pending])
    },
  }
}
