/** Explicit registrations distinguish a dependent execution from a progress handoff. */
import { z } from 'zod'

export const dependentOperationSchema = z.object({ name: z.string().trim().min(1),
  arguments: z.record(z.string(), z.unknown()) }).strict()

/** Require a decision and its concrete operation together; neither field implies scientific support. */
export function pairedOperation(input, context) {
  if (input.pendingDecision !== undefined && input.dependentOperation === undefined)
    context.addIssue({ code: 'custom', path: ['dependentOperation'], message: 'Provide dependentOperation with pendingDecision; omit both when saving progress only.' })
  if (input.dependentOperation !== undefined && input.pendingDecision === undefined)
    context.addIssue({ code: 'custom', path: ['pendingDecision'], message: 'Provide pendingDecision with dependentOperation; omit both when saving progress only.' })
}
