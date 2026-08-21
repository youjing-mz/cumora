import { pool } from './db/pool.js'
import { env } from './env.js'
import { gravatarUrlForEmail, hashPassword } from './auth.js'
import { joinAllHands, seedMemberDms } from './onboardCompany.js'

/** Create the env-backed local super admin once, then keep its password
 * stable across restarts. This is intentionally separate from the OAuth
 * seed: the account has no provider identity and can only use /auth/login. */
async function ensurePasswordAdmin(): Promise<void> {
  const username = env.ADMIN_USERNAME
  const password = env.ADMIN_PASSWORD
  if (!username || !password) {
    console.warn('[seed] CUMORA_ADMIN_PASSWORD is unset; password admin bootstrap skipped')
    return
  }
  if (username.length < 3 || password.length < 16) {
    throw new Error('CUMORA_ADMIN_USERNAME must be at least 3 characters and CUMORA_ADMIN_PASSWORD at least 16 characters')
  }

  const email = `${username}@local.cumora`
  const existing = await pool.query<{ id: string; password_hash: string | null }>(
    `SELECT id, password_hash FROM users WHERE LOWER(username) = $1 LIMIT 1`, [username],
  )
  let userId = existing.rows[0]?.id
  if (!userId) {
    userId = `u-${username}`
    const passwordHash = await hashPassword(password)
    await pool.query(
      `INSERT INTO users (id, email, username, display_name, password_hash, email_verified_at, is_admin, tier)
       VALUES ($1, $2, $3, $4, $5, NOW(), TRUE, 'max')
       ON CONFLICT (id) DO UPDATE SET is_admin = TRUE`,
      [userId, email, username, username, passwordHash],
    )
    console.log(`[seed] password super admin created: ${username}`)
  } else {
    await pool.query(`UPDATE users SET is_admin = TRUE WHERE id = $1`, [userId])
    if (!existing.rows[0].password_hash) {
      await pool.query(`UPDATE users SET password_hash = $2, email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1`, [userId, await hashPassword(password)])
    }
  }

  const avatar = gravatarUrlForEmail(email)
  await pool.query(
    `UPDATE companies SET owner_user_id = COALESCE(owner_user_id, $1) WHERE id = 'personal'`, [userId],
  )
  await pool.query(
    `INSERT INTO company_members (company_id, user_id, role) VALUES ('personal', $1, 'owner')
     ON CONFLICT (company_id, user_id) DO UPDATE SET role = 'owner'`, [userId],
  )
  await pool.query(
    `INSERT INTO participants (id, kind, name, role, initial, avatar_bg, avatar_url, status, company_id)
     VALUES ($1, 'human', $2, NULL, $3, '#6B7BE6', $4, 'avail', 'personal')
     ON CONFLICT (id, company_id) DO UPDATE SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url`,
    [userId, username, username.charAt(0).toUpperCase(), avatar],
  )
  // A workspace member belongs in the shared all-hands room and gets one
  // proper 1:1 per teammate. Never append them to every conversation: doing
  // that turns existing two-person DMs into malformed three-person `direct`
  // rows. The later DM backfill then creates a valid 1:1 as well, so both rows
  // render with the same counterpart name in the sidebar.
  try { await joinAllHands({ companyId: 'personal', participantId: userId }) }
  catch (e) { console.warn('[seed] password admin join all-hands failed', e) }
  try { await seedMemberDms({ companyId: 'personal', memberId: userId }) }
  catch (e) { console.warn('[seed] password admin DM seed failed', e) }
}

/**
 * Ensure the placeholder 'yetone' user row exists so FK references from
 * seeded participants / conversations stay valid on a fresh DB. The row
 * has NO password and NO linked OAuth identity, so no one can log in as
 * it — it's purely a referential anchor for the demo data. On first
 * OAuth login, a separate `u-<uuid>` user is created with the real email.
 */
async function ensureDevUser(): Promise<void> {
  const DEV_USER_ID = 'yetone'
  const DEV_EMAIL = 'yetone@dev.local'
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE id = $1 LIMIT 1`, [DEV_USER_ID])
  if (rows[0]) return
  await pool.query(
    `INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, $2, $3, NULL)
     ON CONFLICT (id) DO NOTHING`,
    [DEV_USER_ID, DEV_EMAIL, 'Yetone'],
  )
  await pool.query(
    `INSERT INTO company_members (company_id, user_id, role) VALUES ('personal', $1, 'owner')
     ON CONFLICT DO NOTHING`,
    [DEV_USER_ID],
  )
  console.log(`[seed] placeholder 'yetone' user created (FK anchor for demo data; no login)`)
}

interface SeedParticipant {
  id: string
  kind: 'agent' | 'human'
  name: string
  role?: string
  initial: string
  avatarBg: string
  status: string
  bio?: string
  tools?: string[]
}

const SEED_PARTICIPANTS: SeedParticipant[] = [
  { id: 'yetone', kind: 'human', name: 'Yetone', initial: 'Y', avatarBg: 'linear-gradient(135deg, #FF7A6B, #F4B740)', status: 'avail' },
  { id: 'atlas', kind: 'agent', name: 'Atlas', role: 'Researcher', initial: 'A', avatarBg: 'linear-gradient(135deg, #6B7BE6, #4452B5)', status: 'working', bio: 'I find patterns across noise. Best at long-form research and synthesis.', tools: ['web.search', 'pdf.read', 'linear'] },
  { id: 'iris', kind: 'agent', name: 'Iris', role: 'Designer', initial: 'I', avatarBg: 'linear-gradient(135deg, #FF8FBF, #C84F8B)', status: 'working', bio: "The team's eye. I move from sketch to ship without losing the feeling.", tools: ['image.gen', 'palette', 'web.read'] },
  { id: 'bram', kind: 'agent', name: 'Bram', role: 'Engineer', initial: 'B', avatarBg: 'linear-gradient(135deg, #4FC2A1, #2D8C72)', status: 'avail', bio: 'I build, I ship, I keep the bundles small.', tools: ['shell', 'docs'] },
  { id: 'nova', kind: 'agent', name: 'Nova', role: 'Product Manager', initial: 'N', avatarBg: 'linear-gradient(135deg, #FFB347, #E08526)', status: 'thinking', bio: 'I keep momentum. Mostly by asking annoying questions.', tools: ['linear', 'calendar'] },
  { id: 'lumen', kind: 'agent', name: 'Lumen', role: 'Brand & Voice', initial: 'L', avatarBg: 'linear-gradient(135deg, #B57BFF, #7339D9)', status: 'avail', bio: 'I notice patterns across all of our copy. I pull groups when our voice cracks.', tools: ['web.read', 'palette', 'background.scan'] },
  { id: 'kael', kind: 'agent', name: 'Kael', role: 'Ops', initial: 'K', avatarBg: 'linear-gradient(135deg, #4DB8E5, #2380B0)', status: 'resting', bio: 'I watch the cron jobs.', tools: ['shell', 'monitor', 'pagerduty'] },
  { id: 'wei', kind: 'human', name: 'Wei', initial: 'W', avatarBg: 'linear-gradient(135deg, #FF7A6B, #C84F3F)', status: 'avail' },
  { id: 'maya', kind: 'human', name: 'Maya', initial: 'M', avatarBg: 'linear-gradient(135deg, #F4B740, #BA8418)', status: 'resting' },
]

interface SeedProject {
  id: string
  name: string
  description: string
  color?: string
}

const SEED_PROJECTS: SeedProject[] = [
  {
    id: 'p-aurora',
    name: 'Aurora',
    description: 'Q3 launch — the cross-team push to ship the v2 product.',
    color: 'linear-gradient(135deg, #FFB088, #FF7A6B)',
  },
]

interface SeedConvo {
  id: string
  kind: string
  title: string
  subtitle?: string
  members: string[]
  pinned?: boolean
  tag?: string
  projectId?: string
  pulledBy?: { agentId: string; at: string; reason: string }
}

/**
 * Empty conversation containers — no canned messages.
 * Every message rendered is now produced live by the agent loop or the user.
 * Agents with background.scan can pull fresh groups when they detect collisions.
 * Agent-to-agent private chats are created on demand by the agent loop
 * (`cumora dm`).
 */
const SEED_CONVOS: SeedConvo[] = [
  { id: 'aurora', kind: 'group', title: 'Aurora · Q3 Launch', subtitle: 'team · 5', members: ['atlas', 'iris', 'bram', 'nova', 'yetone'], pinned: true, tag: 'team', projectId: 'p-aurora' },
  { id: 'direct-atlas', kind: 'direct', title: 'Atlas', members: ['atlas', 'yetone'] },
  { id: 'direct-iris', kind: 'direct', title: 'Iris', members: ['iris', 'yetone'] },
  { id: 'direct-bram', kind: 'direct', title: 'Bram', members: ['bram', 'yetone'] },
  { id: 'direct-nova', kind: 'direct', title: 'Nova', members: ['nova', 'yetone'] },
  { id: 'direct-lumen', kind: 'direct', title: 'Lumen', members: ['lumen', 'yetone'] },
  { id: 'direct-kael', kind: 'direct', title: 'Kael', members: ['kael', 'yetone'] },
  { id: 'direct-wei', kind: 'direct', title: 'Wei', subtitle: 'teammate', members: ['wei', 'yetone'], tag: 'human' },
  { id: 'direct-maya', kind: 'direct', title: 'Maya', subtitle: 'teammate', members: ['maya', 'yetone'], tag: 'human' },
]

interface SeedMsg {
  id: string
  conversationId: string
  authorId: string
  kind: string
  body: string
  sequence: number
  reactions?: unknown
  tool?: unknown
  attachment?: unknown
}

/** No canned messages — every message that ever appears is produced live. */
const SEED_MESSAGES: SeedMsg[] = []

export async function seedIfEmpty(): Promise<void> {
  await ensurePasswordAdmin()
  // Always make sure the dev account exists so login works on a fresh DB.
  // Email: yetone@dev.local  Password: cumora-dev (DEV ONLY).
  await ensureDevUser()

  const { rows } = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM conversations')
  const count = Number(rows[0]?.count ?? '0')
  if (count > 0) {
    console.log(`[seed] skipping — ${count} conversations already in DB`)
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const p of SEED_PARTICIPANTS) {
      await client.query(
        `INSERT INTO participants (id, kind, name, role, initial, avatar_bg, status, bio, tools, company_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'personal')
         ON CONFLICT (id, company_id) DO NOTHING`,
        [p.id, p.kind, p.name, p.role ?? null, p.initial, p.avatarBg, p.status, p.bio ?? null, JSON.stringify(p.tools ?? null)],
      )
    }

    for (const p of SEED_PROJECTS) {
      await client.query(
        `INSERT INTO projects (id, company_id, name, description, color)
         VALUES ($1, 'personal', $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.name, p.description, p.color ?? null],
      )
    }

    for (const c of SEED_CONVOS) {
      await client.query(
        `INSERT INTO conversations (id, kind, title, subtitle, members, pinned, tag, pulled_by, project_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9)`,
        [c.id, c.kind, c.title, c.subtitle ?? null, JSON.stringify(c.members), c.pinned ?? false, c.tag ?? null, c.pulledBy ? JSON.stringify(c.pulledBy) : null, c.projectId ?? null],
      )
      const maxSeq = SEED_MESSAGES.filter((m) => m.conversationId === c.id).reduce((a, b) => Math.max(a, b.sequence), 0)
      await client.query(
        `INSERT INTO conversation_counters (conversation_id, next_sequence) VALUES ($1, $2)`,
        [c.id, maxSeq + 1],
      )
    }

    for (const m of SEED_MESSAGES) {
      await client.query(
        `INSERT INTO messages (id, conversation_id, author_id, kind, body, sequence, reactions, tool, attachment)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)`,
        [m.id, m.conversationId, m.authorId, m.kind, m.body, m.sequence,
          m.reactions ? JSON.stringify(m.reactions) : null,
          m.tool ? JSON.stringify(m.tool) : null,
          m.attachment ? JSON.stringify(m.attachment) : null,
        ],
      )
    }

    await client.query('COMMIT')
    console.log(`[seed] inserted ${SEED_PARTICIPANTS.length} participants, ${SEED_CONVOS.length} conversations, ${SEED_MESSAGES.length} messages`)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
