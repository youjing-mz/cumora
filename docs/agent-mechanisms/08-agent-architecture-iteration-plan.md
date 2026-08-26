# Agent 四层架构迭代计划

## 1. 目标状态

本计划把现有两条相对独立的执行链收敛到清晰的四层模型，同时保持聊天 Agent 和自治 Run 各自的状态机：

```text
Persona          Bram / Iris / Atlas / Nova
       │ responsibility + visible communication
       ▼
Control Plane    plan / policy / run / lease / evidence / approval
       │ Job Envelope + assignment
       ▼
Worker           Codex Builder / Verifier / Deployment / Readback
       │ execution binding
       ▼
Engine / Host    managed or Codex/Claude on Cumora Cloud/Mac/VPS
```

第一阶段只针对 Cumora 自举 Loop，保持 WIP limit 为 1。完成标准不是“UI 出现四个标签”，而是能够从任意 Work Item 回答：谁负责、谁执行、在哪运行、依据什么权限、由谁验证。

## 2. 原则与非目标

### 原则

- Persona 是稳定身份，Worker 是一次 Attempt 的执行主体。
- Control Plane 的状态机、政策、预算和证据门禁不交给 Persona prompt。
- Engine/Host 可以替换，不改变 Persona identity 或 Work Item history。
- builder 与 verifier 的独立性由服务端身份和 assignment 校验，不依赖自报字符串。
- 先补齐自举 Loop，再扩展多项目和复杂并行调度。

### 非目标

- 不把所有聊天 turn 都升级为 autonomy Work Item。
- 不让 Bram/Iris 直接获得生产或 protected branch 权限。
- 不在第一轮实现任意 DAG、多仓库事务或动态 Agent 市场。
- 不为了“看起来像团队”把内部 Worker 全部加入 participant roster。

## 3. Phase 0：术语与文档收敛

### 交付物

- 以 [00-agent-architecture.md](./00-agent-architecture.md) 作为唯一术语源。
- 将文档中的 `Cloud Agent` 改为 `Autonomy Control Plane`、`Planner step` 或 `Persona on Cumora Cloud Runtime`。
- 将 `Codex` 明确标注为 Persona Engine 或 autonomy Worker。
- 机制文档和 runbook 互相引用，不重复发明架构名词。

### 验收

- 搜索 `Cloud Agent` 时只剩历史说明或明确的弃用说明。
- 任一架构图都能区分 Persona、Control Plane、Worker、Engine/Host。
- 文档明确标记“当前实现”与“目标状态”。

## 4. Phase 1：Run responsibility 与 execution assignment

> 状态：**已实现（当前实现）**。表 `autonomy_run_assignments`、claim 时的执行绑定、
> `POST /api/autonomy/projects/:projectId/runs/:runId/assignments`、
> `run.assignment.created/changed` 事件、snapshot 的 `assignments` 投影，以及
> completion 对 lease-bound builder 身份的独立性校验均已落地并有测试覆盖。
> 关键实现：[server/src/autonomy/responsibilities.ts](../../server/src/autonomy/responsibilities.ts)、
> [server/src/autonomy/coordinator.ts](../../server/src/autonomy/coordinator.ts)、
> [server/src/db/migrate.ts](../../server/src/db/migrate.ts)；
> 测试：[server/src/__tests__/autonomy-assignments.test.ts](../../server/src/__tests__/autonomy-assignments.test.ts)、
> [server/src/__integration__/autonomy-assignments.test.ts](../../server/src/__integration__/autonomy-assignments.test.ts)。

### 目标

让自治 Run 同时记录可见责任人和实际执行者，解决“Bram 还是 codex-builder 在做事”的核心歧义。

### 数据模型

新增 `autonomy_run_assignments`（每个 `(run_id, responsibility)` 一行，历史保存在
append-only `autonomy_events` 中）：

```text
id
company_id
project_id
work_item_id
run_id
responsibility
persona_agent_id nullable
worker_id nullable
computer_id nullable
engine nullable
producer_id nullable
visibility
assigned_by
created_at
```

首批 `responsibility`：

- `planner`
- `researcher`
- `builder_owner`
- `design_reviewer`
- `independent_verifier`
- `deployment_operator`
- `readback_operator`

### API 与事件

- Project snapshot（`GET /api/autonomy/projects/:projectId`）返回 `assignments`，
  每条含 `responsibility`、`personaAgentId`/`personaName`、`workerId`、`computerId`、
  `engine`、`producerId`、`visibility`。
- claim 时 Control Plane 自动写入执行绑定（responsibility 由 `job_type` 推导：
  implementation→`builder_owner`，deployment→`deployment_operator`，
  readback→`readback_operator`），`worker_id`/`producer_id`/`computer_id` 取自签名的
  设备身份而非请求体；随后 `POST .../runs/:runId/assignments` 由 owner/admin 绑定
  可见责任 Persona。
- 新增 `run.assignment.created`、`run.assignment.changed` 事件。
- complete API 不再仅相信请求体里的 `builderId`：独立性校验对照 lease 对应的
  `builder_owner` 执行 assignment（`worker_id`/`computer_id`/`producer_id`）以及完成
  设备身份，`independent_verification` 的 producer 若命中其中任一即拒绝。

### 验收

- 一个 Run 可以显示 `builder_owner=Bram`、`worker=<executing computer>`（执行绑定与
  Persona 合并在同一行）。
- off-board 的 Persona（`departed_at` 已设）不会获得新 assignment，但历史 assignment 保留。
- assignment 不能引用其他 company 的 Persona、Computer 或 Worker。
- builder_owner Persona 不能同时成为同一 Run 的 independent_verifier；完成时也拒绝由
  builder 执行身份提交的 `independent_verification`。

## 5. Phase 2：显式 Planner 与角色选择

> 状态：**已实现（当前实现）**。表 `autonomy_plans`（每个 Work Item 一个受策略校验的
> 计划修订）、`autonomy_runs.plan_id`、确定性且无 LLM 的默认 planner
> ([server/src/autonomy/planner.ts](../../server/src/autonomy/planner.ts))、把 plan
> `responsibilities` 落成 Phase 1 assignment、以及“越权/未知 action → Decision Request”
> 分支均已落地并有测试覆盖。snapshot 现返回 `plans`。
> 测试：[server/src/__tests__/autonomy-planner.test.ts](../../server/src/__tests__/autonomy-planner.test.ts)、
> [server/src/__integration__/autonomy-planner.test.ts](../../server/src/__integration__/autonomy-planner.test.ts)、
> 以及端到端 [server/src/__e2e__/autonomy-loop.e2e.test.ts](../../server/src/__e2e__/autonomy-loop.e2e.test.ts)（`npm run test:e2e`）。

### 目标

当前 message/manual intake 可以直接生成 implementation Run。此阶段增加独立 Planning Attempt，使 Persona 分工成为可审计决策，而不是隐含在 prompt 中。

### Planner 输出

```json
{
  "problem": "...",
  "desiredOutcome": "...",
  "acceptanceCriteria": ["..."],
  "risk": "medium",
  "requiredCapabilities": ["repo:write", "codex", "staging:deploy"],
  "responsibilities": [
    {"role": "builder_owner", "preferredPersona": "bram"},
    {"role": "design_reviewer", "preferredPersona": "iris", "when": "ui_changed"}
  ],
  "approvalNeeds": ["git.merge_master"]
}
```

Planner 可以参考 Persona role 和项目历史，但 Policy Engine必须验证所有动作、路径、预算和 approval。若没有合适 Persona，可以保持 responsibility 未绑定并请求人类选择；不能虚构一个 roster member。

### 验收

- 每个 implementation Run 都能追溯到 plan revision。
- 同一输入重试复用 Work Item，不重复创建 Planner Attempt。
- Planner 请求未知 action、超预算或 protected path 时生成 Decision Request。
- 修改 Planner prompt 不会改变已创建 Run 的 Contract 或 Envelope。

## 6. Phase 3：Worker capability、身份与 fencing

> 状态：**已实现（当前实现）**。`computers.capabilities` / `max_concurrent_jobs`、
> Job Envelope 的 `requiredCapabilities`、能力+并发门控的 claim、attempt-scoped
> fencing（`autonomy_runs.leased_by_computer_id` + 过期即 attempt+1）、副作用前的
> `POST /api/autonomy/jobs/:runId/preflight`（worker 在 push/deploy 前调用）、以及
> `POST /api/autonomy/computers/:computerId/capabilities` 均已落地并有测试。
> 关键实现：[server/src/autonomy/capabilities.ts](../../server/src/autonomy/capabilities.ts)、
> [server/src/autonomy/coordinator.ts](../../server/src/autonomy/coordinator.ts)、
> [server/src/autonomy/worker.ts](../../server/src/autonomy/worker.ts)。
> 测试：[server/src/__tests__/autonomy-capabilities.test.ts](../../server/src/__tests__/autonomy-capabilities.test.ts)、
> [server/src/__integration__/autonomy-scheduler.test.ts](../../server/src/__integration__/autonomy-scheduler.test.ts)（capability mismatch、并发 claim、lease 过期、fencing、并发上限）。
> 尚未做：把 Evidence producer 完全从 worker 凭据推导、独立 verifier 的服务端签发身份（归入 P4）。

### 目标

把目前通过 `assigned_computer_id` 和环境变量隐式表达的能力，升级为服务端可验证的调度条件。

### 能力模型

Computer/Worker 注册：

```text
engines: codex, claude, managed
platform: macos-arm64, linux-amd64
capabilities: repo:read, repo:write, browser, staging:deploy, production:deploy
repositoryScopes
maxConcurrentJobs
credentialClasses
lastSeenAt
```

Job Envelope 增加：

```text
requiredCapabilities
assignmentId
attempt
fencingToken
baseCommit
environment
```

### 调度规则

1. company/project 隔离。
2. capability 全部满足。
3. assigned Computer 优先。
4. online、版本兼容、并发容量足够。
5. priority、queue age、成本和区域排序。
6. claim 后签发 attempt-scoped worker identity 与 fencing token。

### 副作用保护

- push、PR、deploy、notification 前调用 lease/fencing preflight。
- 旧 Attempt 的 heartbeat、complete 和外部副作用全部拒绝。
- Evidence producer 由 worker credential 推导，API 不接受覆盖身份。

### 验收

- 无 `staging:deploy` 能力的节点不能 claim 需要 Staging 的 Job。
- 两个节点并发 claim 不会执行同一 Attempt。
- lease 过期后旧 Worker 不能 push、complete 或部署。
- retry 创建新 Attempt，并保留前一次错误和 Evidence。

## 7. Phase 4：Persona-mediated review 与沟通

> 状态：**已实现（当前实现）**。`POST /api/autonomy/runs/:runId/reviews` 让持有 review
> assignment 的 Persona 提交结构化 `review_evidence` 或 `decision_request`；Evidence 的
> producer 由服务端从 assignment 校验（不接受自报字符串），independent verifier 与
> builder owner 独立性在提交时强制；design review 只作为证据、不改变 Run/Contract 状态；
> 被指派的 independent verifier Persona 可用服务端可信身份满足 merge gate；snapshot 新增
> `reviews` 投影（区分 Persona 判断与 Worker 执行）。
> 关键实现：[server/src/autonomy/reviews.ts](../../server/src/autonomy/reviews.ts)、
> [server/src/autonomy/coordinator.ts](../../server/src/autonomy/coordinator.ts)。
> 测试：[server/src/__tests__/autonomy-reviews.test.ts](../../server/src/__tests__/autonomy-reviews.test.ts)、
> [server/src/__integration__/autonomy-reviews.test.ts](../../server/src/__integration__/autonomy-reviews.test.ts)。
> 说明：本阶段交付 Control Plane 侧的结构化 review 通道；由 agent turn loop 通过
> `cumora` 命令自动产出 review 属后续接线工作。

### 目标

让 Bram/Iris 等 Persona 真正参与 Loop Task，但不让聊天成为状态真相。

### 行为

- Bram 接收 builder result/diff 摘要，提交 engineering review 或对用户解释方案。
- Iris 只在 UI/设计范围变化时收到 design review assignment。
- Atlas 在根因证据不足或外部研究需要时执行 research assignment。
- Nova 处理目标冲突、优先级和验收标准澄清。

每次 Persona 参与产生一个普通 Agent turn，同时通过受控命令把结论提交为 `review_evidence` 或 `decision_request`。未提交结构化结果的聊天内容只作为上下文。

### 验收

- Iris 的设计评论不会自动覆盖 Contract 或代码状态。
- Bram 是 builder owner 时不能成为 independent verifier。
- Persona turn 失败不会丢失 Run；Coordinator 可重试、换 Persona 或请求人工决策。
- 对外消息清楚区分“Bram 的判断”和“Codex Worker 的执行结果”。

## 8. Phase 5：UI 信息架构

### 目标

在不暴露内部噪音的前提下，让用户理解责任、执行和状态。

### 页面模型

Work Item 详情展示：

```text
Goal / status / next gate
Responsible Personas
  Nova · planner
  Bram · engineering owner
  Iris · design reviewer

Execution
  codex-builder-17 · Codex · MacBook Pro
  lease / attempt / duration / cost

Verification
  verifier-08 · PASS
  required checks / staging / evidence hashes

Approval
  git.merge_master · waiting for project_owner
```

Agent roster 只展示 Persona；Computers 页面展示 Host/Engine；自治页面展示 Worker/Attempt。不要把三种对象混在同一列表。

### 验收

- 用户可以在一次点击内回答“谁负责”和“谁在执行”。
- Worker 离线显示为执行基础设施问题，不把 Bram 标记为离职或失忆。
- Persona 更换 Host/Engine 后历史 Run 仍显示当时的 execution snapshot。
- Approval 页面只引用持久 Evidence，不引用模型的私有草稿。

## 9. Phase 6：Dogfood、迁移与收敛

### Dogfood 场景

使用 `修复会话重复` 完成一条真实自举 Loop：

1. Nova 形成验收标准。
2. Atlas 提供根因证据（需要时）。
3. Bram 成为 builder owner。
4. Codex Worker 在隔离 worktree 实现。
5. Iris 仅在 UI diff 存在时审查。
6. Independent Verifier 产生独立 Evidence。
7. Control Plane 停在 merge Approval。
8. 合入后 deployment/readback 完成或创建 follow-up。

### 迁移策略

- 旧 `autonomy_runs` 没有 assignment 时，投影为 `worker_id=result.builderId`，Persona 为空，不猜测 Bram。
- 现有 `participants.computer_id/engine` 保持不变；这是 Persona runtime binding，不迁移为 Worker assignment。
- `codex-builder` 等旧 producer 字符串保留在历史 Evidence，新 Evidence 使用服务端 worker identity。
- 不把历史内部 Worker 自动创建为 Participant。

### 完成门槛

- 一条用户目标无需常规催促到达 `awaiting_merge`。
- 任一状态都能从 event/evidence 重放。
- builder/verifier 独立性经过服务端测试。
- 服务、节点或网络中断后 Run 可恢复且副作用不重复。
- 用户研究确认 Bram/Iris、Control Plane、Worker、Engine/Host 的含义不再混淆。

## 10. 推荐实施顺序

```text
P0 术语收敛                                          ✅ 已完成
  ↓
P1 Run assignments                                  ✅ 已完成
  ↓
P2 Planner + Persona role selection                 ✅ 已完成
  ↓
P3 Capability scheduler + authenticated worker identity + fencing   ✅ 已完成
  ↓
P4 Persona-mediated review                          ✅ 已完成
  ↓
P5 UI projections                                   ← 下一步
  ↓
P6 Dogfood and migration hardening
```

优先级上，P1 与 P3 是架构正确性的核心；P4 与 P5 决定产品体验是否真正清晰。不要先做“Bram 正在指挥 Codex”的 UI 动画，再补 assignment 和 evidence identity，否则界面会表达数据库无法证明的关系。

## 11. 每阶段证据要求

| 阶段 | 最低证据 |
| --- | --- |
| P0 | 文档链接检查、术语扫描、治理 contract check |
| P1 | tenant/role/independence migration + integration tests |
| P2 | planner schema tests、policy conflict tests、idempotency tests |
| P3 | concurrent claim、lease expiry、fencing、capability mismatch tests |
| P4 | Persona review integration tests、Evidence producer tests |
| P5 | UI state tests、可用性走查、跨端 snapshot consistency |
| P6 | staging dogfood、independent verification、production readback |
