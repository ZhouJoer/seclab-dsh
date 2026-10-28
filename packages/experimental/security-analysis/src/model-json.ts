/** Strict JSON decoding with an optional whole-response Markdown fence. @module */

/** Decode model text without extracting objects from surrounding prose.
 * @param response - JSON or one complete json/unlabelled code fence.
 * @returns untrusted JSON for the owning response schema to validate.
 */
export function parseModelJson(response: string): unknown {
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/u.exec(response.trim())
  return JSON.parse(fenced?.[1] ?? response)
}
