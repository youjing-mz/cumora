/**
 * Phase 3 of the four-layer agent architecture (see
 * docs/agent-mechanisms/08-agent-architecture-iteration-plan.md).
 *
 * Capabilities turn a node's implicit fitness (engines + environment) into an
 * explicit, server-verifiable allow-set the scheduler checks before handing it
 * a Job. Pure module (no DB) so the semantics are unit-tested and shared by the
 * coordinator and API.
 */

/** Capabilities the scheduler understands today. Not exhaustive — unknown
 *  strings are allowed through so a node can advertise forward-compatible
 *  capabilities, but these are the ones jobs currently require. */
export const KNOWN_CAPABILITIES = [
  'repo:read',
  'repo:write',
  'browser',
  'staging:deploy',
  'production:deploy',
  'production:read',
] as const

/** Normalize arbitrary input into a clean, deduped capability string list. */
export function normalizeCapabilities(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  for (const value of input) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) seen.add(trimmed)
  }
  return [...seen]
}

/**
 * A node with no declared capabilities is treated as unconstrained (legacy /
 * undeclared), so existing pairings keep claiming everything. Once a node
 * declares a capability set, the scheduler enforces it.
 */
export function isUnconstrained(capabilities: string[] | null | undefined): boolean {
  return !capabilities || capabilities.length === 0
}

/** Capabilities in `required` that `have` does not cover. Empty ⇒ satisfied. */
export function missingCapabilities(required: string[], have: string[]): string[] {
  const set = new Set(have)
  return required.filter((capability) => !set.has(capability))
}
