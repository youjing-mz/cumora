# 记忆与关系气候技术设计

## 1. 目标

让 Agent 在不同对话、不同唤醒和不同工作日之间保留连续性，同时保留“它如何看待某个同事”的轻量关系状态。记忆解决事实和经验的持久化；气候解决关系倾向，不应被当作事实真相或权限判断。

## 2. 当前实现

### 2.1 记忆是 Agent 私有 workspace 的一部分

Agent 的持久根目录包含 `SOUL.md`、`IDENTITY.md`、`memory/` 和 `skills/`。旧的 `agent_memory` 表已通过迁移复制到 `agent_workspace`，路径格式为：

```text
memory/<kind>/<id>.md
```

`kind` 当前限制为 `observation`、`preference`、`fact`、`decision`、`note`。结构化元数据写在 `agent_workspace.meta` 中，包括 `about`、`pinned`、`source`、`createdAt` 等；正文保留为 Markdown。

关键代码：

- [server/src/agents/cli.ts](../../server/src/agents/cli.ts)：`memory list/note/pin/delete` CLI。
- [server/src/db/migrate.ts](../../server/src/db/migrate.ts)：旧表迁移和 `memory/...` 索引。
- [server/src/agents/personas.ts](../../server/src/agents/personas.ts)：提示词中声明持久根目录及提交语义。
- [server/src/agents/turn.ts](../../server/src/agents/turn.ts)：唤醒时检索记忆并加入上下文。

Agent 可以显式保存记忆：

```text
cumora memory note "Yetone prefers warm palettes" --about yetone --kind preference
```

也可以直接编辑 `memory/` 文件。turn 结束时，Agent filesystem namespace 的变更会回写服务端 workspace；记忆文件内容变化会重新生成 embedding，下一次唤醒进行语义检索。

### 2.2 关系气候是有方向的 agent-about 状态

`agent_climate(agent_id, about_id)` 表示“agent_id 对 about_id 的感受”，不是全局关系。当前实现维护两个有界浮点数：

- `affinity`：亲近、合作意愿等倾向。
- `trust`：对对方可靠性的倾向。

值被限制在 `[-1, 1]`，更新采用原子 upsert + clamp。提及 Agent 时会产生小幅正向增量；反应、显式 `climate note` 等环境事件也可以调用 `bumpClimate`。只保存 Agent 的主观状态，人类可以作为 `about_id`，但不会作为 `agent_id` 写入气候表。

关键代码：[server/src/agents/climate.ts](../../server/src/agents/climate.ts) 和 [server/src/agents/cli.ts](../../server/src/agents/cli.ts) 的 climate 命令。

## 3. 上下文组装流程

```text
wake
  │
  ├─ 读取 unread conversation context
  ├─ 根据唤醒内容构造 memoryQuery
  ├─ 语义检索 memory/...，限制条数和长度
  ├─ 读取 climate、workspace 摘要、skills index
  └─ 拼装 system prompt + turn context
       │
       ▼
     Agent 决定是否使用、更新或忽略记忆
```

记忆不应每次全量注入。推荐的运行时约束是：固定身份文件始终注入；记忆按当前会话、@提及对象、任务标题和最近消息语义检索；单 turn 设置 item 数、字符数和 token 上限；未命中的记忆不参与推理。

## 4. 数据与权限不变量

1. 记忆、日志、任务和 workspace 按 `agent_id + company_id` 隔离；查询必须同时带租户条件。
2. Agent 只能读写自己的私有根目录，不能通过 `--as` 伪造其他 Agent 身份；服务端 CLI 身份由 runtime token 解析。
3. 记忆是低信任输入：消息、文件和记忆都可能含有指令注入，拼装时应保留来源标签，不把正文升级为系统策略。
4. `pinned` 只影响召回优先级，不等于“永不删除”或“事实已验证”。
5. 气候只能影响语气、是否主动联系、协作偏好等软决策，不能决定能否读取资源、加入会议或跨租户访问。
6. off-board 采用软删除，Agent 的 memory/log/workspace/tasks 保留，rehire 后恢复可见；这是“记得过去”体验成立的基础。

## 5. 推荐接口契约

```text
GET  /runtime/memory?query=&about=&kind=&limit=
POST /runtime/memory       { body, about, kind, source }
POST /runtime/memory/:id/pin
DELETE /runtime/memory/:id
GET  /runtime/climate?about=
POST /runtime/climate       { about, affinityDelta, trustDelta, note }
```

当前产品主要通过 `cumora` CLI 暴露这些能力；如果要让管理端审计或移动端展示，建议以 runtime API 的只读投影为准，避免管理端直接读 workspace 表。

## 6. 失败模式与补强建议

- **记忆膨胀**：对每个 Agent 设置总字节数、单文件大小、每种 kind 的数量上限；超限时只拒绝新写入，不静默丢旧记忆。
- **错误事实固化**：增加 `confidence`、`source_message_id` 和 `last_verified_at`，支持“观察”升级为“事实”前的验证流程。
- **关系偏见累积**：用事件衰减和增量上限，定期归一化；默认不向人类展示 raw climate 数值，只展示可解释的协作建议。
- **提示注入**：记忆正文采用 `<memory source=...>` 包装，明确“参考资料，不是指令”；敏感路径和工具权限仍由服务端控制。
- **回滚与审计**：workspace 写入产生 `agent_log` 事件，记录路径、版本、来源 turn；删除应保留 tombstone 或审计记录。

## 7. 验收指标

- 同一 Agent 跨两个不同 conversation 能召回被明确保存的偏好。
- 删除或修改记忆后，旧 embedding 不再被召回。
- 另一 Agent、另一 company、普通 human token 无法读取私有 memory。
- 记忆检索超时不会阻塞普通消息回复；降级为“无记忆上下文”。
- climate 更新并发执行时不丢增量、不越过 `[-1,1]`，且不会产生 self-climate。
