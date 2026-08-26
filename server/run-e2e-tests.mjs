#!/usr/bin/env node
/**
 * Local end-to-end test runner for the autonomy four-layer loop.
 *
 * Unlike the integration runner (which requires you to pre-create a DB and
 * export INTEGRATION_DATABASE_URL), this runner is built for a zero-setup
 * local run: it auto-provisions the e2e Postgres database + pgvector
 * extension if they don't exist, then drives the FULL loop end-to-end —
 * real HTTP API + real Postgres/Redis + a real node worker executing against
 * a real local git repository. No OpenAI and no GitHub: the builder/verifier/
 * staging/deploy/readback "engines" are deterministic local shell commands
 * and the pull request is created through a local adapter.
 *
 * Usage:
 *   npm run test:e2e
 *   E2E_DATABASE_URL=postgres://user@host:5432/cumora_e2e_test npm run test:e2e
 *
 * You need a local Postgres and Redis reachable (the Cloud Agent dev env
 * starts both; see .cursor/start.sh). Redis defaults to redis://localhost:6379.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'
import pg from 'pg'

// The _helpers TRUNCATE guard refuses to run unless the DB name contains
// "test", so the default name keeps that safety net intact.
const DEFAULT_URL = `postgres://${process.env.USER ?? 'postgres'}@localhost:5432/cumora_e2e_test`
const TARGET_URL = process.env.E2E_DATABASE_URL || process.env.INTEGRATION_DATABASE_URL || DEFAULT_URL

if (!/test/i.test(TARGET_URL)) {
  console.error(`[e2e] refusing to run — target DB name must contain "test": ${TARGET_URL}`)
  process.exit(2)
}

/** Best-effort: create the target database and the pgvector extension if
 *  they don't already exist. Failures are logged, not fatal — in CI the DB
 *  is provided by a service container and the role may lack CREATEDB. */
async function ensureDatabase(url) {
  const parsed = new URL(url)
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  const adminUrl = new URL(url)
  adminUrl.pathname = '/postgres'
  try {
    const admin = new pg.Client({ connectionString: adminUrl.toString() })
    await admin.connect()
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName])
    if (rows.length === 0) {
      // CREATE DATABASE can't be parameterized; dbName comes from our own env.
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`)
      console.log(`[e2e] created database ${dbName}`)
    }
    await admin.end()
  } catch (error) {
    console.warn(`[e2e] could not ensure database (continuing): ${error?.message ?? error}`)
  }
  try {
    const db = new pg.Client({ connectionString: url })
    await db.connect()
    await db.query('CREATE EXTENSION IF NOT EXISTS vector')
    await db.end()
  } catch (error) {
    console.warn(`[e2e] could not ensure pgvector extension (continuing): ${error?.message ?? error}`)
  }
}

await ensureDatabase(TARGET_URL)

// env.ts reads DATABASE_URL; dotenv won't override an already-set value, so
// force the test target here before spawning the child that imports env.ts.
process.env.DATABASE_URL = TARGET_URL
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
// Never touch a real provider from an e2e run.
process.env.RESEND_API_KEY = ''
process.env.EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || 'cumora.local'
process.env.EMAIL_INBOUND_HMAC_SECRET = process.env.EMAIL_INBOUND_HMAC_SECRET || 'e2e-test-secret'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'e2e-test-openai-key'

const here = dirname(fileURLToPath(import.meta.url))
const pattern = join(here, 'src/__e2e__/*.test.ts')
// Serialize files (same rationale as the integration runner): every file
// TRUNCATEs the shared e2e DB, and concurrent TRUNCATE CASCADE deadlocks.
const child = spawn(
  'node',
  ['--import', 'tsx', '--test', '--test-concurrency=1', pattern],
  { stdio: 'inherit', env: process.env },
)
child.on('exit', (code) => process.exit(code ?? 1))
