# Agent 主动性与唤醒调度技术设计

## 1. 目标

让 Agent 在没有人直接提问时也能检查工作面、发现值得推进的事情，并自主选择 DM、群聊、拉小组或沉默。主动性不是“每隔 N 分钟让模型说一句话”，而是“定时产生候选机会，低成本判断是否值得唤醒，再由主模型决定动作”。

## 2. 当前实现

核心模块：

- [server/src/agents/idle.ts](../../server/src/agents/idle.ts)：按租户挑选 quiet agent，执行 heartbeat。
- [server/src/agents/agenda.ts](../../server/src/agents/agenda.ts)：收集 Kanban、Calendar 和 stalled conversation，调用小模型分类。
- [server/src/agents/scheduler.ts](../../server/src/agents/scheduler.ts)：Redis 事件到 runtime/pod 的 wake/steer 路由。
- [server/src/agents/runtime/wake-bus.ts](../../server/src/agents/runtime/wake-bus.ts)：按 Agent 分发 wake SSE。
- [server/src/env.ts](../../server/src/env.ts)：`IDLE_INTERVAL_MS`、`IDLE_MIN_QUIET_MIN` 等运行参数。

默认 idle cadence 为 15 分钟，且同一 Agent 至少安静 25 分钟后才成为候选。每个 company tick 只挑一个候选，避免多个 Agent 在同一时间自发发言。

## 3. 唤醒判定模型

Agenda 收集三类输入：

1. 近 30 天内未完成、被分配给 Agent 或提及 Agent 的 Kanban card。
2. 当前时间前后窗口内的 Calendar event（过去 15 分钟到未来 30 分钟）。
3. 5 分钟到 6 小时未推进的 conversation stall，包含最近消息尾部，帮助区分“等待中”和“已经自然结束”。

小模型只回答：

```json
{ "actionable": true, "focus": "先处理登录回归的验证", "reason": "..." }
```

若没有候选，或分类器判断 skip，则不启动主模型。分类器故障时 fail-open 到通用 idle wake，防止短时 outage 把所有有任务的 Agent 静默掉。

```text
setInterval(runIdleTick, IDLE_INTERVAL_MS)
       │
       ├─ 每个 company 选一个 quiet agent
       ├─ gatherAgentAgenda(agent, company)
       ├─ small model: actionable? focus?
       │       ├─ no  → 记录 idle log，不唤醒
       │       └─ yes → background_scan + focused brief
       └─ 无 agenda → generic idle wake
```

## 4. 从消息到主动行动

正常消息和 synthetic idle wake 最终都进入同一个 Agent turn loop。主模型收到的规则是：可以不做任何事；如果有价值才使用正常工具：

- `cumora reply`：在群聊或 DM 发言。
- `cumora dm` / private chat：联系一个人或另一个 Agent。
- `cumora pull-group`：为明确决策拉起小组。
- 文件、board、calendar、email、memory、climate 工具：推进真实工作。

主模型必须调用 `set_turn_status` 表明 `done`、`continue`、`blocked`、`waiting` 或 `needs_clarification`。普通模型文字只是私有草稿，不自动变为用户可见消息。

## 5. 调度正确性

主动性最容易造成噪声和成本失控，因此需要以下约束：

- synthetic wake 走低优先级预算，过载时可以丢弃，下一个 tick 会重新评估；人类消息 wake 不受此预算限制。
- 相同 stalled conversation 的 nudge 用 Redis `NX + TTL` 抢占，保证一个 cooldown 内只有一个 Agent 发起。
- fallback classifier 连续三次没有推动新消息后停止继续 poke；conversation 有新消息时清零计数。
- wake 是 durable 的：普通消息已写入 DB，即便 SSE 丢失，Agent 重连/轮询仍能从 inbox 追上。
- busy Agent 的新消息可走 steer，在下一个安全的模型 hop 注入；直接 @mention/DM 优先级高于普通群活动。
- 同一 Agent 的 wake 要 debounce/coalesce，避免一个消息 burst 触发 N 次大模型 turn。
- 服务端 freshness gate 在 `cumora reply` 写入前检查 unseen sequence；并发情况下旧草稿会进入 HELD，而不是直接污染房间。

## 6. cadence 与产品控制

当前 cadence 是服务端环境参数，而不是用户级可视化设置。要支持“你设置 cadence”，建议增加：

```text
agent_schedule(
  agent_id, company_id, enabled,
  interval_seconds, quiet_hours,
  timezone, max_wakes_per_day,
  allowed_actions, updated_by, version
)
```

解析优先级建议为：公司默认 < Agent 默认 < 项目覆盖 < 临时 snooze。所有周期都换算成租户时区的下一次 due_at；不要直接为每个 Agent 创建独立 Node timer，应使用持久化 job + Redis/DB claim，保证多副本只执行一次。

## 7. 风险与验收

- 费用：记录每次 classifier、wake、主模型 turn 的 cost ledger，提供每 Agent/项目/天的预算。
- 噪音：主动消息必须带 `source=initiative` 和触发依据，支持用户静音、暂停和审计。
- 并发：多 Agent 同时看到同一 card 时需要 board card claim/lease，而不能只依赖 prompt。
- 休眠：BYOA daemon 离线时保留 unread/wake 状态，重连后 drain；不能把主动任务当作已完成。
- 指标：wake-to-action latency、skip ratio、主动消息采纳率、重复 nudge 率、每次有效推进成本。

验收至少覆盖：空 agenda 不调用大模型；有 actionable card 能收到 focused brief；分类器故障仍可恢复；同一 stall 不会被多个 Agent 同时 poke；服务器重启后 due wake 不丢。
