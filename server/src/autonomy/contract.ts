import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js'
import { minimatch } from 'minimatch'
import { parse as parseYaml } from 'yaml'

export type PolicyEffect = 'allow' | 'deny' | 'require_approval'
export type PolicyDecision = PolicyEffect | 'stop_and_request_decision'

export interface ActionPolicy {
  effect: PolicyEffect
  reason: string
  approvalRole?: string
  requiresEvidence?: string[]
  remediation?: string
}

export interface CheckDefinition {
  command: string
  timeoutMinutes: number
}

export interface ProjectOperatingContract {
  apiVersion: 'cumora.ai/v1alpha1'
  kind: 'ProjectOperatingContract'
  metadata: {
    project: string
    version: number
    owners?: string[]
  }
  repository: {
    url: string
    defaultBranch: string
    branchPrefix: string
    writablePaths: string[]
    protectedPaths: string[]
  }
  intake: {
    conversationMode: 'disabled' | 'bound_conversation'
    deduplicationWindowHours: number
  }
  actions: Record<string, ActionPolicy>
  checks: Record<string, CheckDefinition>
  verification: {
    independent: true
    requiredBeforeMerge: string[]
    requiredEvidence: string[]
  }
  budgets: {
    maxChangedFiles: number
    maxAttempts: number
    maxRuntimeMinutes: number
    maxModelCostUsd: number
  }
  runtime: {
    runner: 'codex' | 'claude' | 'test'
    leaseMinutes: number
    unknownAction: 'stop_and_request_decision'
  }
  discovery?: {
    enabled?: boolean
    sources?: Array<'ci_failure' | 'production_error' | 'shipping_readback' | 'friction'>
    wipLimit?: number
  }
}

interface ContractTestFile {
  apiVersion: 'cumora.ai/v1alpha1'
  kind: 'ProjectContractTests'
  tests: Array<{
    name: string
    action: string
    expect: PolicyDecision
  }>
}

export interface LoadedProjectGovernance {
  sourceRoot: string
  vision: string
  visionHash: string
  contract: ProjectOperatingContract
  contractHash: string
  contractTests: ContractTestFile
  effectiveHash: string
}

export interface JobEnvelope {
  apiVersion: 'cumora.ai/v1alpha1'
  kind: 'CodingJob'
  jobType: 'implementation' | 'deployment' | 'readback' | 'verification'
  workItemId: string
  runId: string
  goal: string
  project: string
  vision: string
  contractVersion: number
  contractHash: string
  branch: string
  repository: ProjectOperatingContract['repository']
  allowedActions: string[]
  forbiddenActions: Array<{ action: string; reason: string; remediation?: string }>
  approvalActions: Array<{ action: string; role: string; reason: string }>
  checks: Array<{ id: string; command: string; timeoutMinutes: number }>
  requiredEvidence: string[]
  /** Capabilities a Worker must have to claim this Job (Phase 3). */
  requiredCapabilities: string[]
  budgets: ProjectOperatingContract['budgets']
  stopAndAskWhen: string[]
}

export class ContractValidationError extends Error {
  constructor(message: string, public readonly errors: ErrorObject[] = []) {
    super(message)
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    )
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function formatValidationErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
    .join('; ')
}

function assertContractReferences(contract: ProjectOperatingContract): void {
  const missingChecks = contract.verification.requiredBeforeMerge.filter((id) => !contract.checks[id])
  if (missingChecks.length > 0) {
    throw new ContractValidationError(`verification references unknown checks: ${missingChecks.join(', ')}`)
  }

  for (const [action, policy] of Object.entries(contract.actions)) {
    const unknownEvidence = (policy.requiresEvidence ?? []).filter(
      (id) => !contract.verification.requiredEvidence.includes(id),
    )
    if (unknownEvidence.length > 0) {
      throw new ContractValidationError(
        `action ${action} requires evidence not declared by verification.requiredEvidence: ${unknownEvidence.join(', ')}`,
      )
    }
  }
}

export async function loadProjectGovernance(sourceRoot = resolve(process.cwd(), '.cumora')): Promise<LoadedProjectGovernance> {
  const [vision, contractText, schemaText, testsText] = await Promise.all([
    readFile(resolve(sourceRoot, 'vision.md'), 'utf8'),
    readFile(resolve(sourceRoot, 'contract.yaml'), 'utf8'),
    readFile(resolve(sourceRoot, 'contract.schema.json'), 'utf8'),
    readFile(resolve(sourceRoot, 'contract-tests.yaml'), 'utf8'),
  ])

  const contract = parseYaml(contractText) as ProjectOperatingContract
  const schema = JSON.parse(schemaText) as Record<string, unknown>
  // `approvalRole` is declared on the parent schema and conditionally required
  // from an `allOf` branch. Ajv's strictRequired check only looks at the local
  // branch, so disable that one syntactic warning while retaining every other
  // strict-schema check.
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false })
  const validate = ajv.compile(schema)
  if (!validate(contract)) {
    throw new ContractValidationError(
      `project operating contract is invalid: ${formatValidationErrors(validate.errors)}`,
      validate.errors ?? [],
    )
  }
  assertContractReferences(contract)

  const contractTests = parseYaml(testsText) as ContractTestFile
  if (
    contractTests?.apiVersion !== 'cumora.ai/v1alpha1'
    || contractTests?.kind !== 'ProjectContractTests'
    || !Array.isArray(contractTests.tests)
  ) {
    throw new ContractValidationError('contract-tests.yaml has an invalid header or tests list')
  }
  runContractTests(contract, contractTests)

  const visionHash = sha256(vision)
  const contractHash = sha256(canonicalJson(contract))
  return {
    sourceRoot,
    vision,
    visionHash,
    contract,
    contractHash,
    contractTests,
    effectiveHash: sha256(`${visionHash}:${contractHash}`),
  }
}

export function decideAction(contract: ProjectOperatingContract, action: string): {
  decision: PolicyDecision
  policy: ActionPolicy | null
} {
  const policy = contract.actions[action] ?? null
  return {
    decision: policy?.effect ?? contract.runtime.unknownAction,
    policy,
  }
}

export function runContractTests(contract: ProjectOperatingContract, tests: ContractTestFile): void {
  const failures = tests.tests.flatMap((item) => {
    const actual = decideAction(contract, item.action).decision
    return actual === item.expect ? [] : [`${item.name}: expected ${item.expect}, got ${actual}`]
  })
  if (failures.length > 0) throw new ContractValidationError(`contract policy tests failed: ${failures.join('; ')}`)
}

export function assertChangedPathsAllowed(
  contract: Pick<ProjectOperatingContract, 'repository' | 'budgets'>,
  paths: string[],
): void {
  const normalized = paths.map((path) => path.replace(/^\.\//, ''))
  const protectedHits = normalized.filter((path) =>
    contract.repository.protectedPaths.some((pattern) => minimatch(path, pattern, { dot: true })),
  )
  if (protectedHits.length > 0) {
    throw new ContractValidationError(`change touches protected paths: ${protectedHits.join(', ')}`)
  }
  const outside = normalized.filter((path) =>
    !contract.repository.writablePaths.some((pattern) => minimatch(path, pattern, { dot: true })),
  )
  if (outside.length > 0) {
    throw new ContractValidationError(`change is outside writable paths: ${outside.join(', ')}`)
  }
  if (new Set(normalized).size > contract.budgets.maxChangedFiles) {
    throw new ContractValidationError(
      `change touches ${new Set(normalized).size} files; budget is ${contract.budgets.maxChangedFiles}`,
    )
  }
}

function safeBranchFragment(workItemId: string): string {
  return workItemId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

export function compileJobEnvelope(input: {
  governance: Pick<LoadedProjectGovernance, 'contract' | 'contractHash' | 'vision'>
  workItemId: string
  runId: string
  goal: string
  jobType?: JobEnvelope['jobType']
  requiredCapabilities?: string[]
}): JobEnvelope {
  const { contract } = input.governance
  const allowedActions: string[] = []
  const forbiddenActions: JobEnvelope['forbiddenActions'] = []
  const approvalActions: JobEnvelope['approvalActions'] = []
  for (const [action, policy] of Object.entries(contract.actions)) {
    if (policy.effect === 'allow') allowedActions.push(action)
    if (policy.effect === 'deny') {
      forbiddenActions.push({ action, reason: policy.reason, remediation: policy.remediation })
    }
    if (policy.effect === 'require_approval') {
      approvalActions.push({ action, role: policy.approvalRole ?? 'project_owner', reason: policy.reason })
    }
  }

  return {
    apiVersion: 'cumora.ai/v1alpha1',
    kind: 'CodingJob',
    jobType: input.jobType ?? 'implementation',
    workItemId: input.workItemId,
    runId: input.runId,
    goal: input.goal,
    project: contract.metadata.project,
    vision: input.governance.vision,
    contractVersion: contract.metadata.version,
    contractHash: input.governance.contractHash,
    branch: `${contract.repository.branchPrefix}${safeBranchFragment(input.workItemId)}`,
    repository: contract.repository,
    allowedActions,
    forbiddenActions,
    approvalActions,
    checks: contract.verification.requiredBeforeMerge.map((id) => ({ id, ...contract.checks[id] })),
    requiredEvidence: contract.verification.requiredEvidence,
    requiredCapabilities: input.requiredCapabilities ?? [],
    budgets: contract.budgets,
    stopAndAskWhen: [
      'the requested change is materially ambiguous',
      'a protected or non-writable path must change',
      'a budget or retry limit would be exceeded',
      'an unknown action or additional capability is required',
      'available evidence conflicts about whether the change is safe',
    ],
  }
}

export function governanceLock(governance: LoadedProjectGovernance): Record<string, unknown> {
  return {
    apiVersion: 'cumora.ai/v1alpha1',
    kind: 'CompiledProjectGovernance',
    project: governance.contract.metadata.project,
    version: governance.contract.metadata.version,
    effectiveHash: governance.effectiveHash,
    sources: {
      vision: { path: '.cumora/vision.md', sha256: governance.visionHash },
      contract: { path: '.cumora/contract.yaml', sha256: governance.contractHash },
      schema: { path: '.cumora/contract.schema.json' },
      tests: { path: '.cumora/contract-tests.yaml' },
    },
    effectiveContract: governance.contract,
  }
}

export function agentBrief(governance: LoadedProjectGovernance): string {
  const { contract } = governance
  const actions = (effect: PolicyEffect) => Object.entries(contract.actions)
    .filter(([, policy]) => policy.effect === effect)
    .map(([action, policy]) => `- \`${action}\`: ${policy.reason}`)
    .join('\n') || '- None'
  return `# Compiled Agent Brief — ${contract.metadata.project}

> Generated from \`.cumora/vision.md\` and \`.cumora/contract.yaml\`.
> Do not edit this file directly. Contract v${contract.metadata.version}, hash \`${governance.contractHash}\`.

## Operating rule

Read the task-specific Job Envelope before acting. If a necessary action is
unknown, denied, requires approval, exceeds budget, or touches a protected
path, stop and create a decision request. Do not work around the boundary.

## Allowed actions

${actions('allow')}

## Human approval required

${actions('require_approval')}

## Denied actions

${actions('deny')}

## Repository scope

- Writable: ${contract.repository.writablePaths.map((path) => `\`${path}\``).join(', ')}
- Protected: ${contract.repository.protectedPaths.map((path) => `\`${path}\``).join(', ') || 'none'}
- Default branch: \`${contract.repository.defaultBranch}\`; feature prefix: \`${contract.repository.branchPrefix}\`
- Maximum changed files: ${contract.budgets.maxChangedFiles}

## Required checks before merge

${contract.verification.requiredBeforeMerge.map((id) => `- \`${id}\`: \`${contract.checks[id].command}\``).join('\n')}

Independent verification is mandatory. The builder cannot produce the
\`independent_verification\` evidence for its own change.
`
}
