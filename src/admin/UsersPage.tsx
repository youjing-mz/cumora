import { text as translate } from '@/i18n'
/**
 * Users — paginated, searchable, with inline detail expand + tier /
 * admin toggles per row.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { adminApi, type AdminUser, type AdminUserDetail, type AdminStats, type Tier } from './api'
import { Pager } from './Pager'
import { useAuth } from '@/stores/auth'
import { useI18n } from '@/i18n'

const PAGE = 50

export function UsersPage({ stats }: { stats: AdminStats | null }) {
  const { t } = useI18n()
  const meId = useAuth((s) => s.user?.id ?? null)
  const [q, setQ] = useState('')
  const [tier, setTier] = useState<Tier | ''>('')
  const [items, setItems] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async (nextOffset: number) => {
    setLoading(true); setErr(null)
    try {
      const r = await adminApi.listUsers({ q, tier, limit: PAGE, offset: nextOffset })
      setItems(r.items); setTotal(r.total); setOffset(r.offset)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }, [q, tier])

  // Reload on search/filter change with a light debounce so each keystroke
  // doesn't spam the API.
  useEffect(() => {
    const t = setTimeout(() => { void load(0) }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [q, tier, load])

  const onTierChange = async (u: AdminUser, next: Tier) => {
    if (u.tier === next) return
    try {
      const updated = await adminApi.patchUser(u.id, { tier: next })
      setItems((rows) => rows.map((r) => (r.id === u.id ? updated : r)))
    } catch (e) { alert(`tier update failed: ${e instanceof Error ? e.message : e}`) }
  }

  const onAdminToggle = async (u: AdminUser) => {
    if (u.id === meId && u.isAdmin) {
      alert("You can't remove your own admin bit.")
      return
    }
    try {
      const updated = await adminApi.patchUser(u.id, { isAdmin: !u.isAdmin })
      setItems((rows) => rows.map((r) => (r.id === u.id ? updated : r)))
    } catch (e) { alert(`admin toggle failed: ${e instanceof Error ? e.message : e}`) }
  }

  /** Suspend / unsuspend. The server enforces "can't suspend self" too —
   *  this client-side guard just spares the operator the round-trip + alert. */
  const onSuspendToggle = async (u: AdminUser): Promise<AdminUser | null> => {
    if (u.id === meId && !u.suspended) {
      alert("You can't suspend yourself.")
      return null
    }
    try {
      if (u.suspended) {
        const updated = await adminApi.unsuspendUser(u.id)
        setItems((rows) => rows.map((r) => (r.id === u.id ? updated : r)))
        return updated
      }
      // Prompt for a reason — surfaced to the user verbatim on the
      // suspended screen so it helps to be specific. Cancelling the
      // prompt aborts the action entirely. Empty string OK (means
      // "no reason given").
      const reason = window.prompt(
        `Suspend ${u.name} (${u.email})?\n\nOptional reason — shown to the user on the lockout screen:`,
        '',
      )
      if (reason === null) return null
      const trimmed = reason.trim()
      const updated = await adminApi.suspendUser(u.id, trimmed || null)
      setItems((rows) => rows.map((r) => (r.id === u.id ? updated : r)))
      return updated
    } catch (e) {
      alert(`suspension toggle failed: ${e instanceof Error ? e.message : e}`)
      return null
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-page-head">
        <div>
          <h1 className="admin-h1">{translate("Users")}</h1>
          <div className="admin-sub">
            {stats
              ? <>{stats.users.total} {t('admin.total')} · {stats.users.admins} {t('admin.admin')} · {stats.users.tiers.free} {t('admin.free')} · {stats.users.tiers.pro} {t('admin.pro')} · {stats.users.tiers.max} {t('admin.max')}</>
              : <>&nbsp;</>}
          </div>
        </div>
        <div className="admin-filters">
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>{t('admin.addUser')}</button>
          <input
            type="search" placeholder={t('admin.emailOrName')} className="admin-input"
            value={q} onChange={(e) => setQ(e.target.value)}
          />
          <select className="admin-select" value={tier} onChange={(e) => setTier(e.target.value as Tier | '')}>
            <option value="">{t('admin.allTiers')}</option>
            <option value="free">{t('admin.free')}</option>
            <option value="pro">{t('admin.pro')}</option>
            <option value="max">{t('admin.max')}</option>
          </select>
        </div>
      </header>

      {err && <div className="admin-banner-err">{err}</div>}

      <div className="admin-table">
        <div className="admin-thead">
          <div>{t('admin.users')}</div>
          <div>{t('admin.tier')}</div>
          <div>{t('admin.admin')}</div>
          <div>{t('admin.companies')}</div>
          <div>{t('admin.joined')}</div>
          <div>{t('admin.lastLogin')}</div>
        </div>
        {loading && items.length === 0 && <div className="admin-row admin-empty">{t('admin.loading')}</div>}
        {!loading && items.length === 0 && <div className="admin-row admin-empty">{t('admin.noUsers')}</div>}
        {items.map((u) => (
          <UserRow
            key={u.id} u={u} expanded={expandedId === u.id}
            onToggleExpand={() => setExpandedId((cur) => (cur === u.id ? null : u.id))}
            onTierChange={(t) => onTierChange(u, t)}
            onAdminToggle={() => onAdminToggle(u)}
            onSuspendToggle={() => onSuspendToggle(u)}
            isMe={u.id === meId}
          />
        ))}
      </div>

      <Pager total={total} pageSize={PAGE} offset={offset} loading={loading} onPage={(o) => void load(o)} />
      {createOpen && (
        <CreateUserModal
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            setItems((rows) => [created, ...rows].slice(0, PAGE))
            setTotal((n) => n + 1)
            setCreateOpen(false)
          }}
        />
      )}
    </div>
  )
}

function CreateUserModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (user: AdminUser) => void
}) {
  const { t } = useI18n()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tier, setTier] = useState<Tier>('free')
  const [isAdmin, setIsAdmin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setErr(null)
    try {
      const created = await adminApi.createUser({
        username: username.trim(),
        email: email.trim() || undefined,
        displayName: displayName.trim() || undefined,
        password,
        tier,
        isAdmin,
      })
      onCreated(created)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="create-user-title">
        <div className="admin-modal-head">
          <div>
            <h2 id="create-user-title">{t('admin.addUser')}</h2>
            <div className="admin-sub">{t('admin.createLocalAccount')}</div>
          </div>
          <button className="admin-modal-close" onClick={onClose} disabled={busy} aria-label={t('admin.close')}>×</button>
        </div>
        <form onSubmit={submit} className="admin-form">
          <label>{t('auth.username')}<input className="admin-input" required value={username} onChange={(e) => setUsername(e.target.value)} placeholder={translate("e.g. alice")} autoFocus /></label>
          <label>{t('admin.displayName')}<input className="admin-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={translate("Alice")} /></label>
          <label>{t('admin.email')} <span className="admin-form-hint">{t('admin.optionalLocal')}</span><input className="admin-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={translate("alice@example.com")} /></label>
          <label>{t('admin.initialPassword')} <span className="admin-form-hint">{t('admin.atLeast16')}</span><input className="admin-input" type="password" required minLength={16} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></label>
          <div className="admin-form-row">
            <label>{t('admin.tier')}<select className="admin-select" value={tier} onChange={(e) => setTier(e.target.value as Tier)}><option value="free">{t('admin.free')}</option><option value="pro">{t('admin.pro')}</option><option value="max">{t('admin.max')}</option></select></label>
            <label className="admin-checkbox"><input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} /> {t('admin.adminAccess')}</label>
          </div>
          {err && <div className="admin-banner-err">{err}</div>}
          <div className="admin-modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>{t('admin.cancel')}</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? t('admin.creating') : t('admin.createUser')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function UserRow({ u, expanded, onToggleExpand, onTierChange, onAdminToggle, onSuspendToggle, isMe }: {
  u: AdminUser
  expanded: boolean
  onToggleExpand: () => void
  onTierChange: (t: Tier) => void
  onAdminToggle: () => void
  onSuspendToggle: () => Promise<AdminUser | null>
  isMe: boolean
}) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => {
    if (!expanded || detail) return
    setLoadingDetail(true)
    adminApi.getUser(u.id)
      .then(setDetail)
      .catch((e) => alert(`load failed: ${e instanceof Error ? e.message : e}`))
      .finally(() => setLoadingDetail(false))
  }, [expanded, detail, u.id])

  // Detail drawer's suspend action — keep the AdminUserDetail snapshot in
  // sync with the freshly-patched row from the parent, so the reason
  // / actor / timestamp re-render without re-fetching.
  const handleSuspendClick = async () => {
    const updated = await onSuspendToggle()
    if (updated && detail) {
      setDetail({ ...detail, ...updated })
    }
  }

  return (
    <>
      <div className={`admin-row ${u.suspended ? 'admin-row-suspended' : ''}`} onClick={onToggleExpand} role="button">
        <div className="admin-cell-user">
          <img className="admin-avatar" src={u.avatarUrl} alt={translate("")} loading="lazy" />
          <div className="admin-cell-user-text">
            <div className="admin-cell-user-name">
              {u.name}
              {isMe && <span className="admin-pill admin-pill-soft" style={{ marginLeft: 8 }}>{translate("you")}</span>}
              {u.suspended && <span className="admin-pill admin-pill-warn" style={{ marginLeft: 8 }}>{translate("suspended")}</span>}
            </div>
            <div className="admin-cell-user-email">@{u.username ?? '—'} · {u.email}</div>
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()} data-label={translate("Tier")}>
          <select className="admin-select admin-select-sm"
            value={u.tier} onChange={(e) => onTierChange(e.target.value as Tier)}>
            <option value="free">{translate("Free")}</option>
            <option value="pro">{translate("Pro")}</option>
            <option value="max">{translate("Max")}</option>
          </select>
        </div>
        <div onClick={(e) => e.stopPropagation()} data-label={translate("Admin")}>
          <button
            className={`admin-toggle ${u.isAdmin ? 'is-on' : ''}`}
            onClick={onAdminToggle}
            disabled={isMe && u.isAdmin}
            title={isMe && u.isAdmin ? "Can't remove your own admin" : ''}
          >
            {u.isAdmin ? 'admin' : '—'}
          </button>
        </div>
        <div data-label={translate("Companies")}>{u.companyCount}</div>
        <div className="admin-cell-mono" data-label={translate("Joined")}>{fmtDate(u.createdAt)}</div>
        <div className="admin-cell-mono" data-label={translate("Last login")}>{u.lastLoginAt ? fmtDate(u.lastLoginAt) : '—'}</div>
      </div>
      {expanded && (
        <div className="admin-row-detail">
          {loadingDetail && <div className="admin-empty">{translate("Loading details…")}</div>}
          {detail && (
            <div className="admin-detail-grid">
              <DetailField label={translate("User ID")} value={detail.id} mono />
              <DetailField label={translate("sub2api ID")} value={detail.sub2apiUserId ? String(detail.sub2apiUserId) : '—'} mono />
              <DetailField label={translate("Created")}   value={fmtDateTime(detail.createdAt)} mono />
              <DetailField label={translate("Last login")} value={detail.lastLoginAt ? fmtDateTime(detail.lastLoginAt) : '—'} mono />
              {/* Suspension card — only shown when the row IS suspended. We
                  surface the reason, who suspended them, and when, so the
                  operator has all the context before deciding to unsuspend. */}
              {detail.suspended && (
                <div className="admin-detail-suspended">
                  <div className="admin-detail-label">{translate("Suspended")}</div>
                  <div className="admin-detail-suspended-meta">
                    {detail.suspendedAt ? fmtDateTime(detail.suspendedAt) : '—'}
                    {detail.suspendedBy ? <> {translate("· by")}{' '}<span className="admin-cell-mono">{detail.suspendedBy}</span></> : null}
                  </div>
                  {detail.suspensionReason && (
                    <div className="admin-detail-suspended-reason">{detail.suspensionReason}</div>
                  )}
                </div>
              )}
              <div className="admin-detail-actions">
                <button
                  className={`btn-ghost ${detail.suspended ? '' : 'admin-btn-danger'}`}
                  onClick={handleSuspendClick}
                  disabled={isMe && !detail.suspended}
                  title={isMe && !detail.suspended ? "You can't suspend yourself" : ''}
                >
                  {detail.suspended ? 'Unsuspend' : translate("Suspend account")}
                </button>
              </div>
              <div className="admin-detail-companies">
                <div className="admin-detail-label">{translate("Companies (")}{detail.companies.length})</div>
                {detail.companies.length === 0 && <div className="admin-empty">{translate("No companies.")}</div>}
                {detail.companies.map((c) => (
                  <div key={c.id} className="admin-detail-company">
                    <div>
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      <div className="admin-cell-user-email">{c.slug} · {c.role}</div>
                    </div>
                    <div className="admin-cell-mono">{c.agentCount} {translate("agents")}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="admin-detail-field">
      <div className="admin-detail-label">{label}</div>
      <div className={mono ? 'admin-cell-mono' : ''}>{value}</div>
    </div>
  )
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { year: '2-digit', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
