/** Located manifest declarations; effective Android permissions require version-specific analysis. @module */
import { XMLParser } from 'fast-xml-parser'
import { SyntaxValidator } from 'fast-xml-validator'
import { z } from 'zod'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Decode ordinary XML produced by JADX, preserving omitted attributes as unknown.
 * @param files - retained JADX resources.
 * @returns package and component declarations, including activity aliases.
 */
export function manifestItems(files: readonly { path: string; text: string }[]): JsonValue[] {
  const file = files.find(file => /(^|\/)AndroidManifest\.xml$/u.test(file.path))
  if (!file) throw new Error('JADX did not produce AndroidManifest.xml')
  if (/<!DOCTYPE|<!ENTITY/iu.test(file.text))
    throw new Error('JADX manifest is not a supported complete XML document')
  SyntaxValidator.validate(file.text, { multipleRoots: false, invalidCharSequence: { comment: true, tagValue: true, attrLt: true } })
  const parsed: unknown = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@',
    parseAttributeValue: false, processEntities: false }).parse(file.text)
  const root = z.object({ manifest: z.record(z.string(), z.json()) }).parse(parsed).manifest
  const items: JsonValue[] = [{ path: file.path, packageName: root['@package'] ?? null,
    versionName: root['@android:versionName'] ?? null, versionCode: root['@android:versionCode'] ?? null,
    usesSdk: root['uses-sdk'] ?? null, permissions: root['uses-permission'] ?? [], text: file.text }]
  const application = root.application
  if (application && typeof application === 'object' && !Array.isArray(application)) {
    for (const component of ['activity', 'activity-alias', 'service', 'receiver', 'provider']) {
      const value = application[component]
      for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) items.push({ path: file.path, component,
          name: entry['@android:name'] ?? null, declaredExported: entry['@android:exported'] ?? null,
          permission: entry['@android:permission'] ?? null, declarations: entry })
      }
    }
  }
  return items
}
