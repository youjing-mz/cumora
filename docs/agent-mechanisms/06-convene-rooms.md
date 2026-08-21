# Convene 房间与决策记录技术设计

## 1. 目标

当一个问题需要多人真实决策时，Agent 可以拉起一次聚焦的 Convene：明确 topic、参与者和顺序，实时展示发言，结束后生成决策摘要，并保留可审计 transcript。Convene 是一次有生命周期的 session，不应只是向群聊发一条“大家来讨论”。

## 2. 当前数据模型

迁移在 [server/src/db/migrate.ts](../../server/src/db/migrate.ts) 中创建：

- `convene_sessions`：`id`、`conversation_id`、`title`、`flair`、`started_by`、`started_at`、`ended_at`、`state`。
- `convene_transcript`：`session_id`、`author_id`、`kind`、`body`、`sequence`、`decision`、`created_at`。
- `convening_info`：用于 Agent pulled group 的原因、证据、asks、trigger 和状态。

当前 session 状态为 `live | ended`；transcript kind 为 `text | thought | tool | decision`。业务层必须额外带 `company_id`，并通过父 conversation 解析租户。

## 3. 生命周期

```text
start
  │  member POST /conversations/:id/convene { topic }
  ▼
live session
  │  snapshot conversation context + agent members
  │  each agent speaks in order
  │  append transcript + publish CH_CONVENE
  ▼
decision classification
  │  strict JSON reached/headline/body
  ├─ reached → append decision entry
  └─ no decision → no decision card
  ▼
ended session
```

API 入口位于 [server/src/api/router.ts](../../server/src/api/router.ts)；编排和 LLM 调用位于 [server/src/agents/convene.ts](../../server/src/agents/convene.ts)；前端实时展示位于 [src/desktop/ConveneView.tsx](../../src/desktop/ConveneView.tsx) 和移动端对应组件。

## 4. 当前编排实现

`startConvene` 只允许父 conversation 成员发起，并先写入 live session，再发布 started 事件。后台 `orchestrate`：

1. 读取 conversation 最近 12 条 text/thought 作为 grounding history。
2. 只保留该 conversation members 中的 active agents。
3. 按 members 顺序串行调用每个 Agent 的 `convene-speech` 模型。
4. 每个 Agent 读取已有 transcript，收到“轮到你了”的 moderator prompt，输出 1～3 句观点。
5. 清洗 hallucinated tool-call markup 后写入 transcript。
6. 用 support model 对完整 transcript 做 decision classification。
7. 有决定则写 `kind='decision'`，再把 session 标记 ended 并广播 ended。

串行编排的优点是顺序清楚、成本可预测、后一个 Agent 能看到前一个 Agent 的观点；缺点是一个慢模型会拖延全场，参与者多时 tail latency 线性增长。

## 5. 实时事件与重连

每次 start、transcript append、end 都发布 `CH_CONVENE`。UI 进入页面时先 `GET active`，再 `GET transcript`，随后订阅 WebSocket；因此 WS 丢包后仍能通过重新读取 transcript 补齐。`convene_transcript.sequence` 必须是单调的，当前实现通过 count 生成，若允许并发发言应改成独立 counter/upsert，避免两个写入拿到相同 sequence。

## 6. 权限和安全边界

- 启动和查看 active session 都要求当前用户是父 conversation member。
- 读取 transcript 时同时校验 session 的父 conversation 属于当前 company，且 caller 在 members 中。
- Agent roster 必须使用 session conversation 的 tenant；不能因为全局 Agent id 相同而跨租户调用。
- Topic、历史消息和 transcript 都是模型输入，必须按不可信资料处理；不能覆盖基础安全规则。
- Decision summary 是模型生成的候选记录，应标记 `generated`，最终需要 human confirm 或明确“团队自动达成”的策略。
- session 结束要幂等；后台编排失败时应写失败状态/错误事件，不能长期停留在 live。

## 7. 交互与产品建议

启动 Convene 时要求：topic、目标、参与者范围、最大时长和是否需要 decision。对于“只想快速听观点”的场景可以跳过 decision classifier；对于高风险操作应要求 human confirm 后才能把 decision 转换为 task、board card 或外部动作。

建议增加：

```text
convene_sessions.max_duration_ms
convene_sessions.max_tokens
convene_sessions.participant_policy
convene_sessions.outcome_status
convene_sessions.failure_reason
```

并支持 pause/resume、跳过离线 Agent、Agent 发起的 Convene、以及将 decision 绑定到 project/card/document。会议上下文默认只读父 conversation 最近窗口；需要长期知识时通过 Agent memory 或文档显式保存，避免每次把全部历史塞进 prompt。

## 8. 可观测性与验收

每个 session 记录 start latency、每位 Agent turn duration、token/cost、transcript append error、decision classifier outcome 和最终状态。前端应能区分 live、ended、failed、timed out。

验收至少包括：

- 非成员不能启动或读取 session。
- 同一 conversation 同时只能有一个 active session，重复 start 应返回已有 session 或明确冲突。
- Agent 顺序稳定，后续发言能读到前文。
- WS 断开重连后 transcript 完整且无重复。
- LLM 超时/异常能结束或标记失败，不遗留永远 live 的 session。
- decision JSON 解析失败不会伪造决策，原始 transcript 仍保留。
