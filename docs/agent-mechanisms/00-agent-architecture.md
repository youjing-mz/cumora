# Cumora Agent 架构总纲

> 本文是 Cumora Agent 术语、职责边界和交互模型的唯一架构入口。其他文档讨论某个子系统时，应沿用本文定义，不再自行解释 “Cloud Agent” 或 “Worker Agent”。

## 1. 架构决策

Cumora 将 Agent 系统拆成四个正交层次：

```text
Persona
  谁在判断和表达？
  例：Bram、Iris、Atlas、Nova

Control Plane
  谁决定任务状态、权限、调度和证据？
  例：Autonomy Coordinator

Worker
  谁实际执行这一次任务或 Attempt？
  例：Codex Builder、Independent Verifier、Deployment Worker

Engine / Host
  使用什么推理引擎、运行在哪里？
  例：Codex on Mac、managed on Cumora Cloud
```

这四层不是四种不同品牌的 Agent，而是四个不同问题的答案。一个 Persona 可以在不同 Host 上使用不同 Engine；一次自治 Run 可以把某个 Persona 设为负责人，再由独立 Worker 执行；Control Plane 负责约束流程，但不冒充 Persona，也不直接执行任意代码。

## 2. 规范术语

| 术语 | 精确定义 | 是否进入团队 roster | 当前主要载体 |
| --- | --- | --- | --- |
| Persona Agent | 有名字、角色、声音、记忆和长期关系的团队成员 | 是 | `participants`、`agent_workspace` |
| Autonomy Control Plane | 管理 Work Item、Run、政策、lease、Evidence 和 Approval 的控制面 | 否 | `autonomy/*` services + Postgres |
| Worker | 执行一次受约束 Job/Attempt 的进程或执行主体 | 默认否 | `autonomy-worker`、Codex/Claude command |
| Engine | 产生推理和工具调用的实现 | 否 | `managed`、`codex`、`claude`、`grok` |
| Host / Computer | 承载 Engine 和 workspace 的机器或托管环境 | 作为基础设施展示 | `computers` |
| Cumora Cloud Runtime | Cumora 提供的 managed Computer 与 per-agent pod | 否 | cloud computer + `turn.ts` |
| Job Envelope | Control Plane 发给 Worker 的不可变任务边界 | 否 | `autonomy_runs.job_envelope` |
| Run / Attempt | 可恢复、可审计的一次任务执行 | 以状态投影展示 | `autonomy_runs`、`autonomy_events` |

### 2.1 不再使用的重载叫法

- 不再用 **Cloud Agent** 同时表示托管 Agent、控制面和 Planner。分别写成 `Persona on Cumora Cloud Runtime`、`Autonomy Control Plane` 或 `Planner step`。
- 不再把 **Codex** 默认当作团队成员。Codex 是 Engine 或 Worker；只有显式创建 Persona 时，它才可能成为 roster identity。
- 不再用 **Agent** 泛指状态机、节点 daemon、模型、Persona 和 worker。无法省略时使用完整限定名。

## 3. 四层职责

### 3.1 Persona：谁在判断和表达

Persona 是用户建立关系的对象。Bram、Iris、Atlas 和 Nova 是内置 Persona：

- Bram：工程判断、实现方案、技术取舍。
- Iris：设计判断、交互与视觉质量。
- Atlas：研究、证据和事实核验。
- Nova：目标、优先级和团队推进。

Persona 拥有长期身份：`name`、`role`、`system_prompt`、`SOUL.md`、`IDENTITY.md`、memory、climate、skills、conversation membership。它可以发言、DM、参加 Convene、保存记忆，也可以成为一个自治 Run 的责任人。

Persona 不天然拥有仓库、生产或跨租户权限。它的风格不能覆盖 Operating Contract，Persona 文本也不能自行创建权限。

当前实现：[server/src/onboardCompany.ts](../../server/src/onboardCompany.ts)、[server/src/agents/personas.ts](../../server/src/agents/personas.ts)。

### 3.2 Control Plane：谁决定流程

Autonomy Control Plane 是确定性服务和少量受限模型步骤的组合，而不是一个长期运行的超级 Persona。它负责：

- intake、来源去重和 Work Item 创建；
- 固化 Vision、Contract version/hash；
- 生成 Job Envelope；
- 状态迁移、预算、lease、retry 和 fencing；
- Worker capability 匹配和调度；
- Evidence 完整性与 producer 独立性校验；
- Approval、merge、deployment 和 readback 的推进；
- append-only audit event。

Planner/Triage 可以由模型辅助，也可以邀请 Nova、Atlas、Bram 或 Iris 贡献专业判断，但最终是否允许执行仍由 Contract 和状态机决定。

当前实现：[server/src/autonomy/coordinator.ts](../../server/src/autonomy/coordinator.ts)、[server/src/autonomy/contract.ts](../../server/src/autonomy/contract.ts)。

### 3.3 Worker：谁实际执行这次任务

Worker 是一次 Attempt 的执行主体。典型 Worker：

- Codex Builder：调查仓库、修改代码、添加测试。
- Independent Verifier：读取目标与 diff，独立给出 PASS/FAIL 证据。
- Deployment Worker：执行已授权的部署 adapter。
- Readback Worker：读取生产状态并回传健康证据。

Worker 必须是短生命周期、可重试、受 lease 和 Envelope 约束的。它默认没有长期人格、关系气候或聊天身份，也不能仅凭自然语言声明完成。

当前实现：[server/src/autonomy/worker.ts](../../server/src/autonomy/worker.ts)、[scripts/autonomy-worker.ts](../../scripts/autonomy-worker.ts)。

### 3.4 Engine / Host：使用什么、运行在哪里

Engine 是推理实现，Host 是承载位置。它们是运行时配置，不是人格：

```text
Persona Bram
  ├─ Host: Cumora Cloud Runtime
  │   └─ Engine: managed / OpenAI Responses API
  └─ Host: user's Mac
      └─ Engine: Codex CLI
```

同一个 Persona 可以迁移 Host 或 Engine而保持名字、记忆和关系。一个 Host 也可以承载多个 Persona 或多个自治 Worker，但必须隔离 workspace、lease、凭据和成本账本。

当前实现：[docs/BYOA.md](../BYOA.md)、[server/src/agents/computer/engine.ts](../../server/src/agents/computer/engine.ts)。

## 4. 两条执行链必须分开

### 4.1 Persona conversation turn

用户在聊天中与 Bram 或 Iris 协作：

```text
Human message
  → mailbox scheduler
  → wake Persona
  → Persona 所绑定的 Computer
  → managed/Codex/Claude Engine
  → cumora tools
  → Persona 以自己的名字回复
```

这里的 durable unit 是 message、inbox cursor 和 `agent_run`。Codex 如果存在，是 Persona 的 Engine；用户看到的 actor 仍是 Bram 或 Iris。

### 4.2 Autonomous project loop

用户提交一个需要端到端推进的项目目标：

```text
Goal / signal
  → Autonomy Control Plane
  → Work Item + Run + Job Envelope
  → Worker claim + lease
  → isolated worktree / environment
  → Evidence
  → verification / approval / deployment / readback
```

这里的 durable unit 是 Work Item、Run、Attempt、Evidence 和 Approval。Codex 是 Worker 或 Worker 内的 Engine；它默认不以团队成员身份发言。

两条链可以协作，但不能混为一个状态机。聊天、Board 和 Documents 是自治 Run 的上下文与投影；`autonomy_runs` 仍是 Loop Task 的权威状态。

## 5. Persona 如何参与 Loop Task

Persona 在 Loop Task 中承担责任和专业判断，Worker 承担执行。推荐关系是：

```text
Work Item: 修复重复 conversation
  ├─ Product owner Persona: Nova
  ├─ Research Persona: Atlas
  ├─ Builder owner Persona: Bram
  ├─ Design reviewer Persona: Iris（UI 相关时）
  ├─ Execution Worker: Codex Builder
  └─ Verification Worker: independent verifier
```

“Bram 负责实现”意味着 Bram 对方案、取舍和对外说明负责；“Codex Worker 执行”意味着 Codex 在 Envelope 允许的 worktree 中完成机械执行和代码修改。两者可以绑定，也可以由 Bram 自己的 Codex Engine完成，但审计必须同时记录责任身份和执行身份。

### 5.1 推荐的 Run assignment

```text
autonomy_run_assignments
  run_id
  responsibility       planner | researcher | builder_owner | design_reviewer | verifier
  persona_agent_id     nullable，例 bram/iris
  worker_id            nullable，例 codex-builder-17
  computer_id          nullable
  engine               nullable，例 codex
  producer_id          Evidence 使用的服务端认证身份
  visibility           visible | internal
  assigned_at
```

同一个 assignment 可以只有 Persona，例如 Nova 负责澄清；也可以只有 Worker，例如生产 readback；代码实现通常同时具有 `persona_agent_id=bram` 与 `worker_id=codex-builder-17`。

## 6. 典型交互

### 6.1 用户直接找 Iris

```text
用户：“重新设计登录页。”
  → Iris 被唤醒
  → Iris 使用所在 Host/Engine 进行设计判断
  → Iris 在 conversation/doc 中产出设计
```

这不自动创建 autonomy Work Item，除非 conversation 被绑定为项目 intake，或者 Iris 显式提议升级为 Loop Task。

### 6.2 用户提交 Loop Task

```text
用户：“修复重复 conversation，并走完测试和 Staging。”
  → Control Plane 创建 Work Item
  → Planner 选择 Bram 为 builder owner
  → Scheduler 选择具有 repo:write + codex + staging 能力的 Worker
  → Codex Worker 执行
  → Bram 接收结果并对用户给出工程摘要
  → Independent Verifier 提交独立 Evidence
  → Control Plane 创建 merge Approval
```

### 6.3 Iris 审查 Codex 的 UI 改动

```text
Codex Worker 产生 diff + Staging URL
  → Control Plane 创建 design_review assignment
  → Iris 查看 Staging 与设计上下文
  → Iris 提交 design_review Evidence
  → Evidence Gate 决定是否满足任务 Contract
```

Iris 的自然语言评论只有在被保存为结构化 Evidence 并带 producer identity 后，才能打开正式门禁。

## 7. 身份与证据不变量

1. `persona_agent_id` 表示责任和表达身份，`worker_id` 表示执行身份，两者不能相互冒充。
2. `computer_id + engine` 是运行位置，不是 Evidence producer 的可信身份。
3. builder owner 可以是 Bram，但 builder Worker 不能同时满足 required independent verifier。
4. Control Plane 不能以 Persona 名义发送消息；需要对外沟通时必须创建 Persona turn 或 system event。
5. Worker 不能获得超出 Job Envelope 的路径、动作、预算和环境权限。
6. Persona 更换 Engine/Host 不应丢失 identity、memory 或 conversation membership。
7. 所有外部副作用都要关联 `work_item_id + run_id + attempt + lease/fencing token`。

## 8. UI 呈现规则

用户界面应同时显示“谁负责”和“由什么执行”，避免只显示一个模糊的 Agent 名称：

```text
Bram · Engineering owner
正在实现重复 conversation 修复

执行详情
  Worker: codex-builder-17
  Engine: Codex
  Host: MacBook Pro
  Run: arun-...
  Contract: v1
```

推荐文案：

- `Bram is reviewing the implementation`：Persona 行为。
- `Codex Worker is running tests for Bram`：Worker 行为。
- `Running on Cumora Cloud`：Host 信息。
- `Autonomy Coordinator is waiting for evidence`：Control Plane 状态。

禁止文案：

- `Cloud Agent is doing it`：无法判断指 Persona、控制面还是 Host。
- `Codex joined the team`：除非真的创建了 Persona participant。
- `Bram passed independent verification`：当 Bram 是 builder owner 时违反独立性语义。

## 9. 当前实现与目标差距

| 能力 | 当前实现 | 目标状态 |
| --- | --- | --- |
| Persona | Bram/Iris/Atlas/Nova 已是持久 participant | 保持现状，增加 Run responsibility |
| Persona Host/Engine | `participants.computer_id/engine` 已支持 managed/BYOA | UI 明确拆开 Persona 与 runtime |
| Control Plane | Work Item、Run、lease、Evidence、Approval 已有 | 增加显式 Planner/assignment/capability matching |
| Worker | 通用 autonomy worker 已能启动 Codex builder/verifier | 服务端认证 worker/verifier identity，完善 fencing |
| Persona ↔ Run | 尚无正式绑定，默认 `codex-builder` 与 Bram 无关 | 新增 assignment，UI 展示责任人与执行者 |
| Planner | message/manual 可直接创建 implementation Run | 先生成结构化 plan，再由 policy 校验和调度 |
| Evidence | 已持久化并检查 builder != verifier 的字符串 identity | identity 由 Control Plane 签发，不能由 Worker 自报 |

## 10. 文档导航

- [04-personas-and-prompt-assembly.md](./04-personas-and-prompt-assembly.md)：Persona 身份与 Prompt。
- [07-autonomy-control-plane-and-codex-loop.md](./07-autonomy-control-plane-and-codex-loop.md)：典型 Loop Task 的控制面与 Worker 时序。
- [08-agent-architecture-iteration-plan.md](./08-agent-architecture-iteration-plan.md)：从当前实现演进到四层模型的计划。
- [docs/BYOA.md](../BYOA.md)：Persona 的 Engine/Host 运行模型。
- [docs/AUTONOMOUS_PROJECTS.md](../AUTONOMOUS_PROJECTS.md)：自治项目状态机、政策和证据模型。
- [docs/AUTONOMY_RUNBOOK.md](../AUTONOMY_RUNBOOK.md)：自举 Loop 的操作手册。
