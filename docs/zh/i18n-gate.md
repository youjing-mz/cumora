# 国际化门禁 (i18n Gate)

Cumora 前端界面的所有用户可见文案均通过 `src/i18n/index.ts` 中的词条字典与 `useI18n()` Hook 进行管理。

## 质量检查门禁

- `npm run i18n:check`：快速防回归门禁，新增未经国际化的硬编码可见文本时报错；
- `npm run i18n:check:strict`：全量严格检查门禁，任何未经 i18n 的 JSX 可见文本均会阻止构建；
- `npm run i18n:coverage`：中文翻译覆盖率校验，确保所有 literal `t(...)` 词条都有对应的中文翻译；
- `npm run build`：生产环境构建前会自动依序运行上述严格检查。

## 开发规范

- 静态扫描器检查 JSX 文本及可见属性（如 `title`、`placeholder`、`aria-label`、`alt`、`label` 等）；
- 忽略 CSS 类名、协议值、日志输出与代码块；
- 新增 UI 文案必须同时补充至 `en` 和 `zh` 字典中，动态值通过插值变量（如 `t('...', { name })`）传递。
