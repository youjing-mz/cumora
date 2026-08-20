import { useI18n, useLocale, type Locale } from '@/i18n'

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, t } = useI18n()
  const setLocale = useLocale((state) => state.setLocale)
  return (
    <label className={`inline-flex items-center gap-2 text-[11px] text-ink-400 ${className}`}>
      <span>{t('language')}</span>
      <select
        aria-label={t('language')}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        className="h-8 rounded-[7px] border border-ink-200 bg-white px-2 text-[11px] text-ink-700 focus:outline-none focus:border-ink-400"
      >
        <option value="en">{t('english')}</option>
        <option value="zh">{t('chinese')}</option>
      </select>
    </label>
  )
}
