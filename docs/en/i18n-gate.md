# Internationalization gate

Cumora's UI copy uses the catalog in `src/i18n/index.ts` and the `useI18n()` hook.

## Checks

- `npm run i18n:check` is the fast no-regression gate. It fails when a new user-visible hard-coded string is added.
- `npm run i18n:check:strict` is the required full gate. It fails on every hard-coded JSX string; the current baseline is clean.
- `npm run i18n:baseline` refreshes the legacy baseline after an intentional migration review. Do not use it to hide a new string without reviewing the output.
- `npm run build` runs the strict gate before TypeScript and Vite production compilation.

The scanner checks JSX text plus visible `aria-*`, `title`, `placeholder`, `alt`, and `ariaLabel` attributes. It intentionally ignores CSS, class names, protocol values, logs, API payloads, and code blocks. User-generated content should remain data, not a translation key.

New UI copy should be added to both `en` and `zh` catalogs and rendered with `t('...')`. Dynamic values belong in interpolation variables, for example `t('agents.offboardQuestion', { name })`.
