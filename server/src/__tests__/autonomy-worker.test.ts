import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { promisify } from 'node:util'
import type { JobEnvelope } from '../autonomy/contract.js'
import { type ClaimedJob, executeClaimedJob, type WorkerConfig } from '../autonomy/worker.js'

const execFileP = promisify(execFile)
const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd })
  return stdout.trim()
}

test('node worker creates an isolated branch, enforces checks and reports PR evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cumora-worker-test-'))
  cleanup.push(root)
  const remote = join(root, 'remote.git')
  const repository = join(root, 'repository')
  const workRoot = join(root, 'worktrees')
  await mkdir(repository)
  await git(root, 'init', '--bare', remote)
  await git(repository, 'init', '-b', 'master')
  await mkdir(join(repository, 'src'))
  await writeFile(join(repository, 'src', 'existing.ts'), 'export const existing = true\n')
  await git(repository, 'add', '.')
  await git(repository, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'initial')
  await git(repository, 'remote', 'add', 'origin', remote)
  await git(repository, 'push', '-u', 'origin', 'master')

  const envelope: JobEnvelope = {
    apiVersion: 'cumora.ai/v1alpha1',
    kind: 'CodingJob',
    jobType: 'implementation',
    workItemId: 'awi-worker-test',
    runId: 'run-worker-test',
    goal: 'Add a regression marker',
    project: 'cumora',
    vision: 'Continuously improve Cumora with evidence.',
    contractVersion: 1,
    contractHash: 'a'.repeat(64),
    branch: 'codex/awi-worker-test',
    repository: {
      url: remote,
      defaultBranch: 'master',
      branchPrefix: 'codex/',
      writablePaths: ['src/**'],
      protectedPaths: ['src/protected/**'],
    },
    allowedActions: ['code.modify', 'git.push_feature_branch'],
    forbiddenActions: [],
    approvalActions: [{ action: 'git.merge_master', role: 'project_owner', reason: 'protected branch' }],
    checks: [{ id: 'regression', command: 'test -f src/regression.ts', timeoutMinutes: 1 }],
    requiredEvidence: ['root_cause', 'diff_summary', 'required_checks', 'independent_verification', 'staging_smoke', 'rollback_plan', 'pull_request'],
    budgets: { maxChangedFiles: 5, maxAttempts: 1, maxRuntimeMinutes: 2, maxModelCostUsd: 1 },
    stopAndAskWhen: ['outside policy'],
  }
  const job: ClaimedJob = {
    runId: envelope.runId,
    leaseToken: 'lease-test',
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    envelope,
  }
  const completions: Array<Record<string, unknown>> = []
  const config: WorkerConfig = {
    serverUrl: 'http://unused.test',
    deviceToken: 'unused',
    repositoryRoot: repository,
    workRoot,
    builderId: 'builder-agent',
    verifierId: 'independent-agent',
    builderCommand: `printf 'export const regression = true\\n' > src/regression.ts && printf 'Root cause: missing canonical regression marker\\n'`,
    verifierCommand: `printf 'PASS: focused change with coverage\\n'`,
    stagingCommand: `printf 'staging smoke passed\\n'`,
    productionCommand: `printf 'production deployed\\n'`,
    readbackCommand: `printf 'production healthy\\n'`,
    pushBranch: true,
    pullRequestAdapter: async ({ branch }) => ({ url: `https://github.test/pull/${branch}`, number: 42 }),
    completionAdapter: async (_job, body) => { completions.push(body); return { status: 'awaiting_merge' } },
  }

  const result = await executeClaimedJob(config, job)
  assert.deepEqual(result, { status: 'awaiting_merge' })
  const completion = completions[0]
  assert.ok(completion)
  assert.equal(completion?.outcome, 'ready_for_merge')
  const evidence = completion?.evidence as Array<{ kind: string; producerId: string }>
  assert.ok(evidence.some((item) => item.kind === 'independent_verification' && item.producerId === 'independent-agent'))
  assert.ok(evidence.some((item) => item.kind === 'pull_request'))
  assert.equal(await git(remote, 'rev-parse', '--verify', 'refs/heads/codex/awi-worker-test').then(() => true), true)
})
