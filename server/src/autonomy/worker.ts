import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { assertChangedPathsAllowed, type JobEnvelope } from './contract.js'

export interface ClaimedJob {
  runId: string
  leaseToken: string
  leaseExpiresAt: string
  envelope: JobEnvelope
}

export interface WorkerConfig {
  serverUrl: string
  deviceToken: string
  repositoryRoot: string
  workRoot: string
  builderId: string
  verifierId: string
  builderCommand: string
  verifierCommand: string
  stagingCommand: string
  productionCommand: string
  readbackCommand: string
  pushBranch: boolean
  githubToken?: string
  pullRequestAdapter?: (input: { envelope: JobEnvelope; branch: string; summary: string }) => Promise<{ url: string; number: number }>
  completionAdapter?: (job: ClaimedJob, body: Record<string, unknown>) => Promise<unknown>
}

interface CommandResult {
  command: string
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

const MAX_CAPTURE_CHARS = 40_000

function bounded(text: string): string {
  return text.length <= MAX_CAPTURE_CHARS ? text : `${text.slice(0, MAX_CAPTURE_CHARS)}\n…truncated…`
}

export async function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
  stdin = '',
): Promise<CommandResult> {
  const started = Date.now()
  return new Promise((resolvePromise, reject) => {
    const child = spawn('/bin/sh', ['-lc', command], {
      cwd,
      env: { ...process.env, CI: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout = bounded(stdout + String(chunk)) })
    child.stderr.on('data', (chunk) => { stderr = bounded(stderr + String(chunk)) })
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ command, exitCode: code ?? 1, stdout, stderr, durationMs: Date.now() - started })
    })
    child.stdin.end(stdin)
  })
}

async function api<T>(config: WorkerConfig, path: string, body: unknown): Promise<T | null> {
  const response = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/autonomy${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.deviceToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.status === 204) return null
  const json = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(json.error || `autonomy API returned ${response.status}`)
  return json
}

export async function claimJob(config: WorkerConfig): Promise<ClaimedJob | null> {
  return api<ClaimedJob>(config, '/jobs/claim', {})
}

function implementationPrompt(envelope: JobEnvelope): string {
  return [
    `You are implementing Cumora autonomous work item ${envelope.workItemId}.`,
    '',
    'GOAL',
    envelope.goal,
    '',
    'PROJECT VISION',
    envelope.vision,
    '',
    'OPERATING BOUNDARY',
    `Contract version ${envelope.contractVersion}, hash ${envelope.contractHash}.`,
    `Writable paths: ${envelope.repository.writablePaths.join(', ')}`,
    `Protected paths: ${envelope.repository.protectedPaths.join(', ') || '(none)'}`,
    `Allowed actions: ${envelope.allowedActions.join(', ')}`,
    `Actions requiring human approval: ${envelope.approvalActions.map((item) => item.action).join(', ')}`,
    `Forbidden actions: ${envelope.forbiddenActions.map((item) => item.action).join(', ')}`,
    '',
    'INSTRUCTIONS',
    '- Inspect the repository and determine the root cause before editing.',
    '- Make the smallest coherent change that satisfies the goal.',
    '- Add regression coverage. Do not merge, deploy production or change protected paths.',
    '- Leave all changes in this worktree. Summarize root cause, changes and residual risk in the final response.',
    '- If a boundary makes the goal impossible, stop and clearly name the required decision; do not work around it.',
  ].join('\n')
}

function verificationPrompt(envelope: JobEnvelope, diff: string): string {
  return [
    `Independently verify work item ${envelope.workItemId}: ${envelope.goal}`,
    `You are not the builder. Contract hash: ${envelope.contractHash}.`,
    'Review the diff against the goal, look for regressions and policy violations.',
    'Return PASS only when the behavior and coverage are convincing; otherwise return FAIL with concrete reasons.',
    '',
    'DIFF',
    diff,
  ].join('\n')
}

function githubRepository(url: string): string | null {
  const ssh = url.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/)
  if (ssh) return ssh[1]
  const https = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/)
  return https?.[1] ?? null
}

async function createPullRequest(input: {
  envelope: JobEnvelope
  config: WorkerConfig
  branch: string
  summary: string
}): Promise<{ url: string; number: number }> {
  if (input.config.pullRequestAdapter) {
    return input.config.pullRequestAdapter({ envelope: input.envelope, branch: input.branch, summary: input.summary })
  }
  const repository = githubRepository(input.envelope.repository.url)
  if (!repository) throw new Error('GitHub PR adapter only supports github.com repository URLs')
  if (!input.config.githubToken) throw new Error('GITHUB_TOKEN is required to create the pull request')
  const response = await fetch(`https://api.github.com/repos/${repository}/pulls`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.config.githubToken}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title: input.envelope.goal.slice(0, 200),
      head: input.branch,
      base: input.envelope.repository.defaultBranch,
      body: [
        `Autonomous work item: ${input.envelope.workItemId}`,
        `Contract: v${input.envelope.contractVersion} (${input.envelope.contractHash})`,
        '',
        input.summary,
        '',
        'Merge requires an explicit Cumora project-owner approval.',
      ].join('\n'),
    }),
  })
  const json = await response.json() as { html_url?: string; number?: number; message?: string }
  if (!response.ok || !json.html_url || !json.number) {
    throw new Error(`GitHub PR creation failed (${response.status}): ${json.message ?? 'unknown error'}`)
  }
  return { url: json.html_url, number: json.number }
}

async function reportCompletion(config: WorkerConfig, job: ClaimedJob, body: Record<string, unknown>): Promise<unknown> {
  if (config.completionAdapter) return config.completionAdapter(job, body)
  return api(config, `/jobs/${job.runId}/complete`, { leaseToken: job.leaseToken, ...body })
}

async function executeOperationalJob(config: WorkerConfig, job: ClaimedJob): Promise<unknown> {
  const command = job.envelope.jobType === 'deployment' ? config.productionCommand : config.readbackCommand
  const evidenceKind = job.envelope.jobType === 'deployment' ? 'production_deployment' : 'production_readback'
  let heartbeat: ReturnType<typeof setInterval> | null = null
  try {
    heartbeat = setInterval(() => {
      void api(config, `/jobs/${job.runId}/heartbeat`, { leaseToken: job.leaseToken })
        .catch((error) => console.warn('[autonomy-worker] heartbeat failed', error instanceof Error ? error.message : error))
    }, 60_000)
    const result = await runShell(command, config.repositoryRoot, 30 * 60_000)
    if (result.exitCode !== 0) throw new Error(`${job.envelope.jobType} command failed: ${result.stderr || result.stdout}`)
    return reportCompletion(config, job, {
      outcome: 'completed',
      builderId: `${job.envelope.jobType}:${config.builderId}`,
      summary: result.stdout || `${job.envelope.jobType} completed`,
      evidence: [{
        kind: evidenceKind,
        producerId: `${job.envelope.jobType}:${config.builderId}`,
        payload: { command: result.command, output: bounded(result.stdout), durationMs: result.durationMs },
      }],
    })
  } catch (error) {
    return reportCompletion(config, job, {
      outcome: 'blocked',
      builderId: `${job.envelope.jobType}:${config.builderId}`,
      summary: error instanceof Error ? error.message : String(error),
      evidence: [],
    })
  } finally {
    if (heartbeat) clearInterval(heartbeat)
  }
}

export async function executeClaimedJob(config: WorkerConfig, job: ClaimedJob): Promise<unknown> {
  const { envelope } = job
  if (envelope.jobType === 'deployment' || envelope.jobType === 'readback') {
    return executeOperationalJob(config, job)
  }
  const worktree = resolve(config.workRoot, envelope.workItemId)
  const baseRef = `origin/${envelope.repository.defaultBranch}`
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let preserveWorktree = true
  try {
    await mkdir(config.workRoot, { recursive: true })
    await runShell(`git worktree remove --force ${JSON.stringify(worktree)}`, config.repositoryRoot, 60_000).catch(() => undefined)
    await runShell('git worktree prune', config.repositoryRoot, 30_000).catch(() => undefined)
    await rm(worktree, { recursive: true, force: true })
    const fetchResult = await runShell(`git fetch origin ${envelope.repository.defaultBranch}`, config.repositoryRoot, 120_000)
    if (fetchResult.exitCode !== 0) throw new Error(`git fetch failed: ${fetchResult.stderr}`)
    const worktreeResult = await runShell(
      `git worktree add -b ${JSON.stringify(envelope.branch)} ${JSON.stringify(worktree)} ${JSON.stringify(baseRef)}`,
      config.repositoryRoot,
      120_000,
    )
    if (worktreeResult.exitCode !== 0) throw new Error(`git worktree creation failed: ${worktreeResult.stderr}`)

    heartbeat = setInterval(() => {
      void api(config, `/jobs/${job.runId}/heartbeat`, { leaseToken: job.leaseToken })
        .catch((error) => console.warn('[autonomy-worker] heartbeat failed', error instanceof Error ? error.message : error))
    }, 60_000)

    const builder = await runShell(
      config.builderCommand,
      worktree,
      envelope.budgets.maxRuntimeMinutes * 60_000,
      implementationPrompt(envelope),
    )
    if (builder.exitCode !== 0) throw new Error(`builder failed: ${builder.stderr || builder.stdout}`)

    const changed = await runShell(`git status --porcelain | sed -E 's/^...//'`, worktree, 30_000)
    const paths = changed.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
    if (paths.length === 0) throw new Error('builder produced no repository change')
    assertChangedPathsAllowed({ repository: envelope.repository, budgets: envelope.budgets }, paths)

    const checkResults: CommandResult[] = []
    for (const check of envelope.checks) {
      const result = await runShell(check.command, worktree, check.timeoutMinutes * 60_000)
      checkResults.push(result)
      if (result.exitCode !== 0) throw new Error(`required check ${check.id} failed: ${result.stderr || result.stdout}`)
    }

    const diffResult = await runShell('git diff --no-ext-diff --binary', worktree, 60_000)
    const diff = diffResult.stdout
    const verifier = await runShell(
      config.verifierCommand,
      worktree,
      Math.min(envelope.budgets.maxRuntimeMinutes, 30) * 60_000,
      verificationPrompt(envelope, diff),
    )
    if (verifier.exitCode !== 0 || !/\bPASS\b/i.test(verifier.stdout)) {
      throw new Error(`independent verifier did not pass: ${verifier.stderr || verifier.stdout}`)
    }

    const staging = await runShell(config.stagingCommand, worktree, 30 * 60_000)
    if (staging.exitCode !== 0) throw new Error(`staging smoke failed: ${staging.stderr || staging.stdout}`)

    const commit = await runShell(
      `git add -A && git -c user.name='Cumora Agent' -c user.email='agent@cumora.local' commit -m ${JSON.stringify(envelope.goal.slice(0, 100))}`,
      worktree,
      120_000,
    )
    if (commit.exitCode !== 0) throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`)
    if (!config.pushBranch) throw new Error('feature-branch push capability is not configured')
    const push = await runShell(`git push --set-upstream origin ${JSON.stringify(envelope.branch)}`, worktree, 180_000)
    if (push.exitCode !== 0) throw new Error(`feature branch push failed: ${push.stderr || push.stdout}`)
    const pr = await createPullRequest({ envelope, config, branch: envelope.branch, summary: builder.stdout })

    const reported = await reportCompletion(config, job, {
      outcome: 'ready_for_merge',
      builderId: config.builderId,
      summary: builder.stdout || `Implemented ${envelope.goal}`,
      evidence: [
        { kind: 'root_cause', producerId: config.builderId, payload: { summary: bounded(builder.stdout) } },
        { kind: 'diff_summary', producerId: config.builderId, payload: { paths, commit: bounded(commit.stdout) } },
        { kind: 'required_checks', producerId: `check:${config.builderId}`, payload: { checks: checkResults } },
        { kind: 'independent_verification', producerId: config.verifierId, payload: { report: bounded(verifier.stdout) } },
        { kind: 'staging_smoke', producerId: `staging:${config.builderId}`, payload: { report: bounded(staging.stdout) } },
        { kind: 'rollback_plan', producerId: config.builderId, payload: { plan: `Revert commit on ${envelope.branch} and redeploy the prior known-good revision.` } },
        { kind: 'pull_request', producerId: config.builderId, payload: pr },
      ],
    })
    preserveWorktree = false
    return reported
  } catch (error) {
    return reportCompletion(config, job, {
      outcome: 'blocked',
      builderId: config.builderId,
      summary: error instanceof Error ? error.message : String(error),
      evidence: [],
    }).catch((reportError) => {
      throw new AggregateError([error, reportError], 'job failed and failure report could not be persisted')
    })
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    // A pushed branch and PR preserve the review artifact; the local worktree
    // is disposable. On a blocked run keep it for operator diagnosis.
    if (!preserveWorktree) {
      await runShell(`git worktree remove --force ${JSON.stringify(worktree)}`, config.repositoryRoot, 60_000).catch(() => undefined)
    }
    await runShell(`git worktree prune`, config.repositoryRoot, 30_000).catch(() => undefined)
  }
}

export function workerConfigFromEnv(): WorkerConfig {
  const required = (name: string): string => {
    const value = process.env[name]?.trim()
    if (!value) throw new Error(`${name} is required for the autonomy worker`)
    return value
  }
  return {
    serverUrl: process.env.CUMORA_SERVER_URL || 'http://127.0.0.1:5181',
    deviceToken: required('CUMORA_DEVICE_TOKEN'),
    repositoryRoot: resolve(process.env.CUMORA_AUTONOMY_REPOSITORY_ROOT || process.cwd()),
    workRoot: resolve(process.env.CUMORA_AUTONOMY_WORK_ROOT || `${tmpdir()}/cumora-autonomy-worktrees`),
    builderId: process.env.CUMORA_AUTONOMY_BUILDER_ID || 'codex-builder',
    verifierId: process.env.CUMORA_AUTONOMY_VERIFIER_ID || 'codex-independent-verifier',
    builderCommand: process.env.CUMORA_AUTONOMY_BUILDER_COMMAND || 'codex exec --full-auto -',
    verifierCommand: required('CUMORA_AUTONOMY_VERIFIER_COMMAND'),
    stagingCommand: required('CUMORA_AUTONOMY_STAGING_COMMAND'),
    productionCommand: required('CUMORA_AUTONOMY_PRODUCTION_COMMAND'),
    readbackCommand: required('CUMORA_AUTONOMY_READBACK_COMMAND'),
    pushBranch: process.env.CUMORA_AUTONOMY_PUSH_BRANCH === '1',
    githubToken: process.env.GITHUB_TOKEN,
  }
}

export async function runWorkerOnce(config = workerConfigFromEnv()): Promise<boolean> {
  const job = await claimJob(config)
  if (!job) return false
  console.log(`[autonomy-worker] claimed ${job.runId} (${job.envelope.workItemId})`)
  const result = await executeClaimedJob(config, job)
  console.log('[autonomy-worker] completed', JSON.stringify(result))
  return true
}
