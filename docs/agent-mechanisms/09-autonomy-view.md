# Autonomy 视图

> [English Version](./09-autonomy-view.en.md)
>
> UI 文案通过 `src/i18n/index.ts` 的 `en` / `zh` catalog 国际化。

关键实现：
[src/components/AutonomyWorkspace.tsx](../../src/components/AutonomyWorkspace.tsx)、
[src/stores/autonomy.ts](../../src/stores/autonomy.ts)、
[src/api/client.ts](../../src/api/client.ts)（`getAutonomyProject` 及写操作方法）。

---

Autonomy 视图（左侧 rail 的分层图标）把一个 Work Item 投影为四层模型，让用户一眼看清“谁负责、谁在执行、谁验证、谁审批”，而不是只看到一个模糊的 Agent 名称。

## 页面结构

- **左栏**：项目选择 + Work Item 列表（目标 + 状态）。
- **右栏**：Work Item 详情，分为五段：
  - **Responsible Personas（谁负责）**：持有可见责任 assignment 的 Persona。
  - **Execution（谁在执行）**：Worker / Engine / Host 与 attempt。
  - **Verification（独立证据）**：Persona review 提交的 `design_review` / `independent_verification` 等，含 producer 与 PASS/FAIL。
  - **Approval（人工关卡）**：`git.merge_master` 等审批与其等待的角色。
  - **Plan（计划）**：验收标准、所需能力、需要审批的动作。

## 写操作（owner / admin）

视图不仅是只读投影；工作区 owner/admin 可直接操作 Loop：

- **指派 Persona**：在 Responsible Personas 中选择职责 + Persona → `POST /api/autonomy/projects/:projectId/runs/:runId/assignments`。
- **提交评审**：在 Verification 中，由已指派的评审人提交 PASS/FAIL 评审证据 → `POST /api/autonomy/runs/:runId/reviews`。producer 由服务端按 assignment 校验。
- **审批合入**：在 Approval 中对 `git.merge_master` 批准 / 驳回（可附备注）→ `POST /api/autonomy/approvals/:approvalId/decision`；批准后 Work Item 变为 `approved_for_merge`。

所有操作成功后自动刷新快照；失败时在详情顶部显示错误横幅。三类对象保持在各自界面：
Persona 在 Agents/roster，Computer/Host 在 You → Computers，Worker/Run 只在本视图投影。

## 本地演示数据

`COMPANY_ID=personal tsx scripts/seed-autonomy-demo.ts` 会生成一个包含责任人、执行绑定、Persona 评审和待审批合入的 Work Item，供本视图演示。
