/** Detect undeclared edits in upstream-owned package sources. @module */
import assert from 'node:assert/strict'
import ts from 'typescript'

/** Read the declared built-in event set from its source module.
 * @param source - TypeScript registry module text.
 * @returns literal event names, rejecting unsupported registry declarations.
 */
export function securitySessionEvents(source: string): string[] {
  const file = ts.createSourceFile('known-event-types.ts', source, ts.ScriptTarget.Latest, true)
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'KNOWN_SESSION_EVENT_TYPES') continue
      const initializer = declaration.initializer
      assert(initializer && ts.isNewExpression(initializer), 'Review the Session registry initializer')
      const array = initializer.arguments?.[0]
      assert(array && ts.isArrayLiteralExpression(array), 'Review the Session registry entries')
      return array.elements.map((element) => {
        assert(ts.isStringLiteral(element), 'Review the nonliteral Session event')
        return element.text
      })
    }
  }
  throw new Error('Missing KNOWN_SESSION_EVENT_TYPES registry')
}

/** Verify that all fork event additions remain declared and readable.
 * @param baseline - upstream event names.
 * @param current - installed event names.
 * @param required - manifest event names.
 * @returns nothing when the manifest covers every addition and every required event exists.
 */
export function verifySecuritySessionEvents(baseline: readonly string[], current: readonly string[], required: readonly string[]): void {
  for (const event of required) assert(current.includes(event), `Missing required Session event ${event}`)
  for (const event of current) {
    if (!baseline.includes(event)) assert(required.includes(event), `Register required Session event ${event}`)
  }
}

/** Verify changes against exact patch paths, including new files in existing packages.
 * @param baseline - paths in the pinned upstream tree.
 * @param changed - committed, working-tree and untracked changed paths.
 * @param declared - exact paths owned by the compatibility manifest.
 * @returns nothing when every shared source edit has an owner.
 */
export function verifySecurityPatchInventory(baseline: readonly string[], changed: readonly string[], declared: readonly string[]): void {
  const normalizedBaseline = baseline.map(path => path.replaceAll('\\', '/'))
  const roots = normalizedBaseline.filter(path => /^(packages|apps)\/.+\/package\.json$/u.test(path))
    .map(path => path.slice(0, -'package.json'.length))
  assert(roots.length > 0, 'Security compatibility baseline contains no packages')
  const owned = new Set(declared.map(path => path.replaceAll('\\', '/')))
  const missing = changed.map(path => path.replaceAll('\\', '/'))
    .filter(path => roots.some(root => path.startsWith(`${root}src/`)) && !owned.has(path))
  assert(missing.length === 0, `Register shared source changes in scripts/security-compatibility.json:\n${missing.join('\n')}`)
}
