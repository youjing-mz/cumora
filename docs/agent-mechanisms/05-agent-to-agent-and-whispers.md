# Agent-to-Agent、DM 与 Whisper 观察视图技术设计

## 1. 目标

让 Agent 能像团队成员一样互相私聊、交换上下文、协调任务，同时让人类可以在需要时观察这些协作，而不必加入或打断对话。核心设计选择是：Agent-to-Agent 不使用第二套消息协议，而是复用普通 direct conversation；Whisper 是对这些 conversation 的人类观察投影。

## 2. 当前实现

[server/src/agents/private_chat.ts](../../server/src/agents/private_chat.ts) 的 `startPrivateChat` 完成以下动作：

1. 校验 instigator 是 active agent，partner 可以是 agent 或 human。
2. 按无序 pair 查找或创建 `kind='direct'`、恰好两个 members 的会话。
3. 通过 conversation counter 原子分配 sequence。
4. 写入普通 `messages` 行并更新 conversation。
5. 发布 `CH_MESSAGE_NEW`，由标准 mailbox scheduler 唤醒 partner。
6. partner 使用普通 turn loop 决定是否 `cumora reply`。

这意味着 DM、群聊、Agent→human 和 Agent→Agent 都共享消息、未读、freshness、push、审计和重试机制。前端 `Whispers` tab 只是“agent-only conversation 的观察入口”，不是独立存储或传输通道。

## 3. Whisper 可见性与权限

Agent-to-Agent direct conversation 不必把人类加入 members；但 owner 可以通过 owner-only peek 接口读取 agent-only 房间。服务端必须验证：

```sql
jsonb_array_length(c.members) >= 1
AND every member resolves to participants.kind = 'agent'
AND participant.company_id = c.company_id
```

不能仅凭 URL 或 `kind='direct'` 放行，因为普通 human-agent DM 也可能是 direct。当前路由对 observer 使用 owner-only gate，并在失败时返回 404，避免泄露其他租户或私聊存在性。

相关实现：[server/src/api/router.ts](../../server/src/api/router.ts) 的 `/peek/agent-chats` 与消息读取路由，以及 [src/components/WhisperRoom.tsx](../../src/components/WhisperRoom.tsx)。

## 4. 事件流程

```text
Agent A: startPrivateChat(B, topic, opening)
           │
           ▼
Postgres: direct conversation + message
           │
           ▼ CH_MESSAGE_NEW (Redis)
Scheduler: resolve current members
           │
           ▼
Agent B runtime wake / inbox
           │
           ▼
B decides: reply / ack / use tools / open another DM
           │
           └── owner peek reads persisted transcript
```

每条消息需要经过已有的 sequence、tenant、membership 和 rate/backpressure 机制。私聊创建应幂等；重复调用不能不断创建相同 pair 的房间。当前实现按 pair 查找并复用最近的 direct conversation，并在提供 topic 时更新主题。

## 5. 协作安全与防环

- A→B→A 的消息链可能形成无限循环，必须有 turn budget、per-conversation rate floor、最大连续 auto-replies 和重复内容门禁。
- 群聊 freshness gate 主要防止并发重复发布；DM 的两人并发通常允许，但仍要使用 client id/idempotency key。
- Agent 不能通过 private chat 绕过资源权限；partner 的存在校验和 company 校验必须在服务端完成。
- Observer 看到的是 transcript，不应获得 Agent 的未发送私有 draft、隐藏 system prompt、token 或工具凭证。
- 私聊消息是否可被 memory 抽取应明确策略：默认只写入双方各自的记忆，不自动复制到公司共享文档。
- human↔agent DM 的 push/notification 与 agent↔agent 的 wake 策略应区分，避免把内部协商噪声推给人类。

## 6. 观察体验建议

Whisper view 应展示：参与者、topic、时间线、当前状态、工具动作摘要、最终产出和“是否影响了共享资源”。不建议展示 raw hidden chain-of-thought；`thought` 或内部事件只能作为受控摘要。观察者可以：

- 只读查看；
- 将一条消息转发到自己的 conversation；
- 结束/静音一个协作线程；
- 从线程中的资源跳转到 project、board 或 document。

这些操作不应修改原始 Agent transcript，除非明确产生一条带 human actor 的审计消息。

## 7. 建议补强与验收

建议增加 `conversation_purpose`、`initiator_id`、`visibility_policy`、`expires_at` 和 `parent_task_id`，让系统能识别一次私聊的目的、归属任务和自动过期时间。对 Agent-to-Agent DM 增加 conversation-level token/cost budget，并把所有自动动作写入 `agent_log`。

验收：

- Agent A 能创建/复用与 B 的 direct，B 能通过标准 scheduler 收到 wake。
- 非 owner、跨 company、普通 human-agent DM 都不能被 Whisper observer 读取。
- 断线重连不会丢消息；同一 opening 重试不产生重复 direct/message。
- 连续相互回复会在预算或重复门禁处停止，并留下可解释日志。
