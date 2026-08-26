/**
 * Local end-to-end test of the autonomy four-layer loop.
 *
 * This drives the WHOLE loop against real infrastructure with no external
 * dependencies:
 *   - real HTTP API (in-process) + real Postgres + real Redis;
 *   - the REAL node worker (executeClaimedJob / runWorkerOnce) executing in a
 *     REAL local git repository (bare remote + working clone + worktrees);
 *   - deterministic local shell "engines" for builder / verifier / staging /
 *     production / readback, and a local pull-request adapter — so no OpenAI
 *     and no GitHub are ever contacted.
 *
 * It proves the four layers line up end-to-end: a goal (Control Plane) becomes
 * a contract-pinned Job Envelope, a Worker claims a lease and produces evidence
 * from a real worktree, the Control Plane gates the merge behind a human
 * approval, and Phase 1 Run assignments record the server-issued executor.
 *
 * Run locally with: `npm run test:e2e` (auto-provisions the e2e database).
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, beforeEach, test } from 'node:test'
import { promisify } from 'node:util'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { syncGitGovernance } from '../autonomy/coordinator.js'
import { runWorkerOnce, type WorkerConfig } from '../autonomy/worker.js'
import { pool } from '../db/pool.js'
import {
  buildApiTestApp,
  ensureSchemaOnce,
  resetAllTables,
  seedUserMembership,
  teardownAll,
} from '../__integration__/_helpers.js'

const execFileP = promisify(execFile)

const USER_ID = 'u-e2e-owner'
const COMPANY_ID = 'c-e2e'
const PROJECT_ID = 'p-e2e'
const CONVERSATION_ID = 'c-e2e-project'
const COMPUTER_ID = 'computer-e2e'
const DEVICE_TOKEN = 'e2e-device-secret'

let server: Server
let baseUrl = ''
const cleanupDirs: string[] = []

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd })
  return stdout.trim()
}

before(async () => {
  await ensureSchemaOnce()
  const app = await buildApiTestApp(USER_ID)
  await new Promise<void>((resolve) => {
    server = createServer(app).listen(0, () => {
      const address = server.address()
      if (address && typeof address === 'object') baseUrl = `http://127.0.0.1:${address.port}`
      resolve()
    })
  })
})

after(async () => {
  await Promise.all(cleanupDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  await teardownAll(server)
})

beforeEach(async () => {
  await resetAllTables()
  await pool.query(
    `INSERT INTO companies (id,name,slug,owner_user_id) VALUES ($1,'E2E Co','e2e-co',$2)`,
    [COMPANY_ID, USER_ID],
  )
  await seedUserMembership(USER_ID, COMPANY_ID, { displayName: 'Project Owner' })
  await pool.query(
    `INSERT INTO projects (id,company_id,name,description) VALUES ($1,$2,'Cumora','Self hosting')`,
    [PROJECT_ID, COMPANY_ID],
  )
  await pool.query(
    `INSERT INTO conversations (id,kind,title,members,company_id,project_id)
     VALUES ($1,'group','Cumora project',$2::jsonb,$3,$4)`,
    [CONVERSATION_ID, JSON.stringify([USER_ID]), COMPANY_ID, PROJECT_ID],
  )
  await pool.query(
    `INSERT INTO computers
       (id,company_id,owner_user_id,name,kind,available_engines,status,credential_hash,paired_at)
     VALUES ($1,$2,$3,'E2E Node','local','["codex"]'::jsonb,'online',$4,NOW())`,
    [COMPUTER_ID, COMPANY_ID, USER_ID, createHash('sha256').update(DEVICE_TOKEN).digest('base64url')],
  )
})

async function human(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${baseUrl}/api/autonomy${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-company-id': COMPANY_ID },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = response.status === 204 ? null : await response.json() as any
  return { response, json }
}

/**
 * Build a real local git repo (bare remote + working clone) and a temp
 * `.cumora` governance dir whose contract points the worker at that LOCAL
 * remote with a trivial check — so the worker never reaches GitHub or runs the
 * heavyweight real checks. Returns paths for the worker config + governance.
 */
async function setupLocalRepoAndGovernance(): Promise<{
  repositoryRoot: string
  workRoot: string
  governanceRoot: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'cumora-e2e-'))
  cleanupDirs.push(root)
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

  // Derive an e2e governance dir from the real .cumora, keeping actions/policy
  // (so contract-tests still pass) but retargeting the repository at the local
  // remote and swapping the checks for a trivial local one.
  const realCumora = resolve(process.cwd(), '.cumora')
  const governanceRoot = join(root, 'cumora')
  await mkdir(governanceRoot)
  const contract = parseYaml(await readFile(join(realCumora, 'contract.yaml'), 'utf8'))
  contract.repository.url = remote
  contract.repository.defaultBranch = 'master'
  contract.checks = { e2e_marker: { command: 'test -f src/regression.ts', timeoutMinutes: 1 } }
  contract.verification.requiredBeforeMerge = ['e2e_marker']
  await writeFile(join(governanceRoot, 'contract.yaml'), stringifyYaml(contract))
  for (const file of ['vision.md', 'contract.schema.json', 'contract-tests.yaml']) {
    await writeFile(join(governanceRoot, file), await readFile(join(realCumora, file), 'utf8'))
  }
  return { repositoryRoot: repository, workRoot, governanceRoot }
}

function workerConfig(repositoryRoot: string, workRoot: string): WorkerConfig {
  return {
    serverUrl: baseUrl,
    deviceToken: DEVICE_TOKEN,
    repositoryRoot,
    workRoot,
    builderId: 'e2e-builder',
    verifierId: 'e2e-verifier',
    // Deterministic local "engines" — no model, no network.
    builderCommand: `printf 'export const regression = true\\n' > src/regression.ts && printf 'Root cause: missing canonical regression marker\\n'`,
    verifierCommand: `printf 'PASS: focused change with regression coverage\\n'`,
    stagingCommand: `printf 'staging smoke passed\\n'`,
    productionCommand: `printf 'production deployed and healthy\\n'`,
    readbackCommand: `printf 'production readback healthy\\n'`,
    pushBranch: true,
    pullRequestAdapter: async ({ branch }) => ({ url: `https://github.local/pull/${branch}`, number: 7 }),
  }
}

test('[e2e] a goal runs the full four-layer loop from intake to production readback', async () => {
  const { repositoryRoot, workRoot, governanceRoot } = await setupLocalRepoAndGovernance()

  // Control Plane: activate governance (pinned at the local remote) and enable
  // gated execution bound to the intake conversation and worker computer.
  await syncGitGovernance({
    companyId: COMPANY_ID, projectId: PROJECT_ID, actorId: USER_ID,
    sourceRoot: governanceRoot, revision: 'e2e-commit',
  })
  const configured = await human(`/projects/${PROJECT_ID}/configure`, 'POST', {
    mode: 'execute_with_gates', conversationId: CONVERSATION_ID, computerId: COMPUTER_ID,
  })
  assert.equal(configured.response.status, 200)

  const created = await human(`/projects/${PROJECT_ID}/work-items`, 'POST', {
    goal: 'Add a canonical regression marker',
  })
  assert.equal(created.response.status, 201)
  const { workItemId, runId } = created.json
  assert.ok(workItemId && runId)

  // Worker: claim the lease and execute the implementation job in a real
  // worktree, pushing the feature branch to the local remote and reporting
  // structured evidence back over HTTP.
  const config = workerConfig(repositoryRoot, workRoot)
  assert.equal(await runWorkerOnce(config), true)

  // The feature branch really landed on the remote.
  await git(join(repositoryRoot), 'fetch', 'origin')
  const branches = await git(repositoryRoot, 'branch', '-r')
  assert.match(branches, /origin\/codex\//)

  let snapshot = await human(`/projects/${PROJECT_ID}`)
  assert.equal(snapshot.json.workItems[0].status, 'awaiting_merge')
  const approval = snapshot.json.approvals.find((a: any) => a.action === 'git.merge_master')
  assert.ok(approval && approval.status === 'pending')

  // Phase 1: the run records the server-issued executor (the claiming device).
  const builder = snapshot.json.assignments.find(
    (a: any) => a.responsibility === 'builder_owner' && a.runId === runId,
  )
  assert.ok(builder, 'implementation run should have a builder execution assignment')
  assert.equal(builder.workerId, COMPUTER_ID)
  assert.equal(builder.computerId, COMPUTER_ID)

  // Human approves the protected-branch merge, then records the merge (the
  // audited fallback for the GitHub webhook), which queues the deployment job.
  const approved = await human(`/approvals/${approval.id}/decision`, 'POST', { decision: 'approved' })
  assert.equal(approved.json.workItemStatus, 'approved_for_merge')
  const merged = await human(`/work-items/${workItemId}/merged`, 'POST', {
    commitSha: 'e2edeadbeef0001', pullRequestUrl: 'https://github.local/pull/codex',
  })
  assert.equal(merged.json.status, 'releasing')

  // Worker claims + runs the deployment job, then the readback job.
  assert.equal(await runWorkerOnce(config), true)
  snapshot = await human(`/projects/${PROJECT_ID}`)
  assert.equal(snapshot.json.workItems[0].status, 'watching')
  assert.equal(await runWorkerOnce(config), true)

  snapshot = await human(`/projects/${PROJECT_ID}`)
  assert.equal(snapshot.json.workItems[0].status, 'completed')

  // Every job's execution was bound to the worker computer (Phase 1).
  const execResponsibilities = new Set(
    snapshot.json.assignments
      .filter((a: any) => a.computerId === COMPUTER_ID)
      .map((a: any) => a.responsibility),
  )
  assert.ok(execResponsibilities.has('builder_owner'))
  assert.ok(execResponsibilities.has('deployment_operator'))
  assert.ok(execResponsibilities.has('readback_operator'))

  // The whole decision chain is replayable from the append-only ledger.
  const eventKinds = snapshot.json.events.map((e: any) => e.kind)
  for (const kind of ['work_item.created', 'run.leased', 'approval.requested',
    'approval.approved', 'git.merged', 'deployment.succeeded', 'readback.passed']) {
    assert.ok(eventKinds.includes(kind), `expected event ${kind}`)
  }

  // Evidence is content-hashed and complete for the whole work item.
  const evidence = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM autonomy_evidence WHERE work_item_id=$1`,
    [workItemId],
  )
  assert.ok((evidence.rows[0]?.count ?? 0) >= 9)
})
