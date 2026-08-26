# Autonomy 视图 / Autonomy View

> 本文档为中英双语。The document below is bilingual (中文 first, English second).
> UI 文案通过 `src/i18n/index.ts` 的 `en` / `zh` catalog 国际化。All UI copy is
> internationalized via the `en` / `zh` catalogs in `src/i18n/index.ts`.

关键实现 / Key implementation:
[src/components/AutonomyWorkspace.tsx](../../src/components/AutonomyWorkspace.tsx),
[src/stores/autonomy.ts](../../src/stores/autonomy.ts),
[src/api/client.ts](../../src/api/client.ts)（`getAutonomyProject` 及写操作方法 /
plus the write-action methods）。

---

## 中文

Autonomy 视图（左侧 rail 的分层图标）把一个 Work Item 投影为四层模型，让用户一眼看清
“谁负责、谁在执行、谁验证、谁审批”，而不是只看到一个模糊的 Agent 名称。

### 页面结构

- 左栏：项目选择 + Work Item 列表（目标 + 状态）。
- 右栏：Work Item 详情，分为五段：
  - **Responsible Personas**（谁负责）：持有可见责任 assignment 的 Persona。
  - **Execution**（谁在执行）：Worker / Engine / Host 与 attempt。
  - **Verification**（独立证据）：Persona review 提交的 `design_review` /
    `independent_verification` 等，含 producer 与 PASS/FAIL。
  - **Approval**（人工关卡）：`git.merge_master` 等审批与其等待的角色。
  - **Plan**：验收标准、所需能力、需要审批的动作。

### 写操作（owner / admin）

视图不仅是只读投影；工作区 owner/admin 可直接操作 Loop：

- **指派 Persona**：在 Responsible Personas 中选择职责 + Persona → `POST
  /api/autonomy/projects/:projectId/runs/:runId/assignments`。
- **提交评审**：在 Verification 中，由已指派的评审人提交 PASS/FAIL 评审证据 →
  `POST /api/autonomy/runs/:runId/reviews`。producer 由服务端按 assignment 校验。
- **审批合入**：在 Approval 中对 `git.merge_master` 批准 / 驳回（可附备注）→
  `POST /api/autonomy/approvals/:approvalId/decision`；批准后 Work Item 变为
  `approved_for_merge`。

所有操作成功后自动刷新快照；失败时在详情顶部显示错误横幅。三类对象保持在各自界面：
Persona 在 Agents/roster，Computer/Host 在 You → Computers，Worker/Run 只在本视图投影。

### 本地演示数据

`COMPANY_ID=personal tsx scripts/seed-autonomy-demo.ts` 会生成一个包含责任人、执行绑定、
Persona 评审和待审批合入的 Work Item，供本视图演示。

---

## English

The Autonomy view (the layered icon in the left rail) projects a Work Item into
the four-layer model so a user can see at a glance *who is responsible, who is
executing, who verified, and who approves* — instead of one blurry Agent name.

### Layout

- Left column: project picker + Work Item list (goal + status).
- Right column: Work Item detail, in five sections:
  - **Responsible Personas** — Personas holding a visible responsibility assignment.
  - **Execution** — the Worker / Engine / Host and attempt.
  - **Verification** — Persona reviews (`design_review` / `independent_verification`,
    …) with producer and PASS/FAIL.
  - **Approval** — approvals such as `git.merge_master` and the role they await.
  - **Plan** — acceptance criteria, required capabilities, approval needs.

### Write actions (owner / admin)

The view is not only a read-only projection; a workspace owner/admin can drive
the loop directly:

- **Assign a Persona** — pick a responsibility + Persona in Responsible Personas →
  `POST /api/autonomy/projects/:projectId/runs/:runId/assignments`.
- **Submit a review** — in Verification, an assigned reviewer submits a PASS/FAIL
  review → `POST /api/autonomy/runs/:runId/reviews`; the producer is verified
  server-side from the assignment.
- **Decide the merge gate** — approve/reject `git.merge_master` (with an optional
  note) in Approval → `POST /api/autonomy/approvals/:approvalId/decision`; on
  approval the Work Item becomes `approved_for_merge`.

Every successful action refreshes the snapshot; a failure shows an error banner
at the top of the detail. The three object types stay in their own surfaces:
Personas in the Agents/roster, Computers/Hosts under You → Computers, and
Workers/Runs are only projected here.

### Local demo data

`COMPANY_ID=personal tsx scripts/seed-autonomy-demo.ts` seeds one Work Item with
responsible Personas, an execution binding, Persona reviews, and a pending merge
approval so this view has data to project.
