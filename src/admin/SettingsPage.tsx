/**
 * Global toggles. Each toggle is a single boolean call to /settings.
 * Renders pessimistically — disable the row while the request flies so
 * a fast double-click doesn't race the server.
 */
import { useEffect, useState } from 'react'
import { adminApi, type AdminLlmSettings, type AdminSettings } from './api'
import { useI18n } from '@/i18n'

export function SettingsPage() {
  const { t } = useI18n()
  const [s, setS] = useState<AdminSettings | null>(null)
  const [llm, setLlm] = useState<AdminLlmSettings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [llmForm, setLlmForm] = useState({
    apiUrl: '', model: '', supportModel: '', compactionModel: '', imageModel: '',
  })
  const [busyKey, setBusyKey] = useState<keyof AdminSettings | null>(null)
  const [llmBusy, setLlmBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    adminApi.settings()
      .then(setS)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(() => {
    adminApi.llmSettings()
      .then((value) => {
        setLlm(value)
        setLlmForm({
          apiUrl: value.apiUrl,
          model: value.model,
          supportModel: value.supportModel,
          compactionModel: value.compactionModel,
          imageModel: value.imageModel,
        })
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [])

  const flip = async (key: keyof AdminSettings) => {
    if (!s || busyKey) return
    setBusyKey(key); setErr(null)
    try {
      const next = await adminApi.setSettings({ [key]: !s[key] })
      setS(next)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setBusyKey(null) }
  }

  const saveLlm = async () => {
    if (llmBusy) return
    setLlmBusy(true); setErr(null)
    try {
      const next = await adminApi.setLlmSettings({
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...llmForm,
      })
      setLlm(next)
      setApiKey('')
      setLlmForm({
        apiUrl: next.apiUrl,
        model: next.model,
        supportModel: next.supportModel,
        compactionModel: next.compactionModel,
        imageModel: next.imageModel,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setLlmBusy(false) }
  }

  const clearLlmKey = async () => {
    if (llmBusy || !llm?.apiKeySet) return
    setLlmBusy(true); setErr(null)
    try {
      const next = await adminApi.setLlmSettings({ apiKey: null })
      setLlm(next)
      setApiKey('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setLlmBusy(false) }
  }

  return (
    <div className="admin-page">
      <header className="admin-page-head">
        <div>
          <h1 className="admin-h1">{t('admin.settings')}</h1>
          <div className="admin-sub">{t('admin.globalToggles')}</div>
        </div>
      </header>

      {err && <div className="admin-banner-err">{err}</div>}

      <div className="admin-settings">
        <SettingRow
          title={t('admin.waitlist')}
          desc={t('admin.waitlistDescription')}
          on={!!s?.waitlist_enabled}
          busy={busyKey === 'waitlist_enabled'}
          disabled={!s}
          onToggle={() => void flip('waitlist_enabled')}
        />
        <SettingRow
          title={t('admin.signupsPaused')}
          desc={t('admin.signupsPausedDescription')}
          on={!!s?.signups_paused}
          busy={busyKey === 'signups_paused'}
          disabled={!s}
          onToggle={() => void flip('signups_paused')}
        />
        <div className="admin-setting" style={{ display: 'block' }}>
          <div className="admin-setting-title">{t('admin.runtimeLlm')}</div>
          <div className="admin-setting-desc" style={{ marginBottom: 14 }}>
            {t('admin.runtimeLlmDescription')}
          </div>
          <div className="admin-form">
            <label>{t('admin.openaiApiKey')} <span className="admin-form-hint">{llm?.apiKeySet ? t('admin.configuredKeep') : t('admin.notConfigured')}</span>
              <input className="admin-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="new-password" placeholder={llm?.apiKeySet ? '••••••••' : 'sk-…'} />
            </label>
            <label>{t('admin.openaiApiUrl')}
              <input className="admin-input" value={llmForm.apiUrl} onChange={(e) => setLlmForm((v) => ({ ...v, apiUrl: e.target.value }))} placeholder="https://api.openai.com/v1" />
            </label>
            <label>{t('admin.openaiModel')}
              <input className="admin-input" value={llmForm.model} onChange={(e) => setLlmForm((v) => ({ ...v, model: e.target.value }))} />
            </label>
            <label>{t('admin.openaiSupportModel')}
              <input className="admin-input" value={llmForm.supportModel} onChange={(e) => setLlmForm((v) => ({ ...v, supportModel: e.target.value }))} />
            </label>
            <label>{t('admin.openaiCompactionModel')}
              <input className="admin-input" value={llmForm.compactionModel} onChange={(e) => setLlmForm((v) => ({ ...v, compactionModel: e.target.value }))} />
            </label>
            <label>{t('admin.openaiImageModel')}
              <input className="admin-input" value={llmForm.imageModel} onChange={(e) => setLlmForm((v) => ({ ...v, imageModel: e.target.value }))} />
            </label>
            <div className="admin-modal-actions" style={{ justifyContent: 'flex-start', padding: 0 }}>
              <button className="btn-primary" onClick={() => void saveLlm()} disabled={llmBusy || !llm}>{llmBusy ? t('admin.saving') : t('admin.saveLlm')}</button>
              <button className="btn-ghost" onClick={() => void clearLlmKey()} disabled={llmBusy || !llm?.apiKeySet}>{t('admin.clearApiKey')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingRow({ title, desc, on, busy, disabled, onToggle }: {
  title: string; desc: string; on: boolean; busy: boolean; disabled: boolean; onToggle: () => void
}) {
  return (
    <div className="admin-setting">
      <div>
        <div className="admin-setting-title">{title}</div>
        <div className="admin-setting-desc">{desc}</div>
      </div>
      <button
        className={`admin-switch${on ? ' is-on' : ''}`}
        onClick={onToggle}
        disabled={disabled || busy}
        aria-pressed={on}
      >
        <span className="admin-switch-thumb" />
      </button>
    </div>
  )
}
