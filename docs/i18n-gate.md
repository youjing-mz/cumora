# Internationalization gate

Cumora's UI copy uses the catalog in `src/i18n/index.ts` and the `useI18n()` hook.

## Checks

- `npm run i18n:check` is the normal no-regression gate. It fails when a new user-visible hard-coded string is added. Existing legacy findings are reported against `scripts/i18n-baseline.json` while they are migrated.
- `npm run i18n:check:strict` fails on every hard-coded JSX string and is the target gate once the legacy baseline reaches zero.
- `npm run i18n:baseline` refreshes the legacy baseline after an intentional migration review. Do not use it to hide a new string without reviewing the output.
- `npm run build` runs the normal gate before TypeScript and Vite production compilation.

The scanner checks JSX text plus visible `aria-*`, `title`, `placeholder`, `alt`, and `ariaLabel` attributes. It intentionally ignores CSS, class names, protocol values, logs, API payloads, and code blocks. User-generated content should remain data, not a translation key.

New UI copy should be added to both `en` and `zh` catalogs and rendered with `t('...')`. Dynamic values belong in interpolation variables, for example `t('agents.offboardQuestion', { name })`.
