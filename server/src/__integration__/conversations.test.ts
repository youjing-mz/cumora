/**
 * Integration tests for conversation list/search shaping.
 *
 * Direct conversation rows are shared by both participants, so the stored
 * `conversations.title` can only ever be correct for one viewer. The API must
 * return a viewer-specific title based on the other member instead.
 */
import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import {
  buildApiTestApp, ensureSchemaOnce, resetAllTables, seedUserMembership, teardownAll,
} from './_helpers.js'
import { pool } from '../db/pool.js'

const ME_USER_ID = 'u-me'
const OTHER_USER_ID = 'u-ada'
let server: Server
let baseUrl = ''

before(async () => {
  await ensureSchemaOnce()
  const app = await buildApiTestApp(ME_USER_ID)
  await new Promise<void>((resolve) => {
    server = createServer(app).listen(0, () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`
      resolve()
    })
  })
})

beforeEach(async () => {
  await resetAllTables()
})

after(async () => {
  await teardownAll(server)
})

async function seedHumanDirectWithSelfStoredTitle(): Promise<{ companyId: string; conversationId: string }> {
  const companyId = 'c-direct-title'
  const conversationId = 'direct-ada-yetone'
  await pool.query(
    `INSERT INTO companies (id, name, slug, owner_user_id)
     VALUES ($1, 'Direct Title Co', 'direct-title-co', $2)`,
    [companyId, ME_USER_ID],
  )
  await seedUserMembership(ME_USER_ID, companyId, {
    email: 'yetone@test.local',
    displayName: 'Yetone',
  })
  await seedUserMembership(OTHER_USER_ID, companyId, {
    email: 'ada@test.local',
    displayName: 'Ada',
  })
  await pool.query(
    `INSERT INTO conversations (id, kind, title, members, tag, company_id)
     VALUES ($1, 'direct', 'Yetone', $2::jsonb, 'human', $3)`,
    [conversationId, JSON.stringify([OTHER_USER_ID, ME_USER_ID]), companyId],
  )
  return { companyId, conversationId }
}

test('[integration] GET /conversations returns the other member as a direct title', async () => {
  const { companyId, conversationId } = await seedHumanDirectWithSelfStoredTitle()

  const res = await fetch(`${baseUrl}/api/conversations`, {
    headers: { 'x-company-id': companyId },
  })
  assert.equal(res.status, 200)
  const rows = await res.json() as Array<{ id: string; title: string }>
  const direct = rows.find((r) => r.id === conversationId)

  assert.equal(direct?.title, 'Ada')
})

test('[integration] GET /search uses the same perspective-specific direct title', async () => {
  const { companyId, conversationId } = await seedHumanDirectWithSelfStoredTitle()

  const res = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent('Ada')}`, {
    headers: { 'x-company-id': companyId },
  })
  assert.equal(res.status, 200)
  const body = await res.json() as { rooms: Array<{ id: string; title: string }> }
  const direct = body.rooms.find((r) => r.id === conversationId)

  assert.equal(direct?.title, 'Ada')
})

test('[integration] admin-created users get pair DMs without joining existing private chats', async () => {
  const companyId = 'personal'
  const agentId = 'agent-atlas'
  const existingDirectId = 'direct-owner-atlas'
  const allHandsId = 'all-hands-personal'
  await pool.query(
    `INSERT INTO companies (id, name, slug, owner_user_id)
     VALUES ($1, 'Personal', 'personal', $2)`,
    [companyId, ME_USER_ID],
  )
  await seedUserMembership(ME_USER_ID, companyId, {
    email: 'owner@test.local',
    displayName: 'Owner',
  })
  await pool.query(`UPDATE users SET is_admin = TRUE WHERE id = $1`, [ME_USER_ID])
  await pool.query(
    `INSERT INTO participants
       (id, company_id, kind, name, role, initial, avatar_bg, status)
     VALUES ($1, $2, 'agent', 'Atlas', 'Researcher', 'A', '#abcdef', 'avail')`,
    [agentId, companyId],
  )
  await pool.query(
    `INSERT INTO conversations (id, kind, title, members, company_id)
     VALUES ($1, 'direct', 'Atlas', $2::jsonb, $3),
            ($4, 'group', 'Everyone', $5::jsonb, $3)`,
    [
      existingDirectId,
      JSON.stringify([ME_USER_ID, agentId]),
      companyId,
      allHandsId,
      JSON.stringify([ME_USER_ID, agentId]),
    ],
  )
  await pool.query(
    `UPDATE companies
        SET all_hands_conversation_id = $2, all_hands_seeded_at = NOW()
      WHERE id = $1`,
    [companyId, allHandsId],
  )

  const res = await fetch(`${baseUrl}/api/admin/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-company-id': companyId },
    body: JSON.stringify({
      username: 'new.local.user',
      displayName: 'New Local User',
      password: 'long-enough-password',
    }),
  })
  const created = await res.json() as { id?: string; error?: string }
  assert.equal(res.status, 201, created.error)
  assert.ok(created.id)

  const { rows: existingDirect } = await pool.query<{ members: string[] }>(
    `SELECT members FROM conversations WHERE id = $1`,
    [existingDirectId],
  )
  assert.deepEqual(existingDirect[0]?.members, [ME_USER_ID, agentId])

  const { rows: allHands } = await pool.query<{ members: string[] }>(
    `SELECT members FROM conversations WHERE id = $1`,
    [allHandsId],
  )
  assert.equal(allHands[0]?.members.includes(created.id), true)

  const { rows: newUserDirects } = await pool.query<{ members: string[] }>(
    `SELECT members FROM conversations
      WHERE company_id = $1 AND kind = 'direct'
        AND members @> to_jsonb(ARRAY[$2::text])
      ORDER BY id`,
    [companyId, created.id],
  )
  assert.equal(newUserDirects.length, 2)
  assert.equal(newUserDirects.every((row) => row.members.length === 2), true)
  assert.deepEqual(
    new Set(newUserDirects.flatMap((row) => row.members).filter((id) => id !== created.id)),
    new Set([ME_USER_ID, agentId]),
  )
})
