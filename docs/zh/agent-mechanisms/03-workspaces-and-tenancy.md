# 工作空间、公司与跨端共享状态技术设计

## 1. 目标

把“团队”从一个聊天列表提升为可协作的工作空间：人和 Agent 共享公司、项目、会话、board、calendar、文档和附件；桌面、浏览器、手机看到同一份 live state；邀请通过邮箱或链接完成，并且每个资源都能明确归属和授权。

## 2. 当前实现分层

### 2.1 租户层

`companies` 是租户根；`company_members(company_id, user_id, role)` 保存 human membership，角色为 owner/admin/member。Agent 通过 `participants.company_id` 进入租户。所有 tenant-bound 表均有 `company_id`，包括 conversations、messages、documents、projects、agent_workspace、agent_memory、agent_log、agent_tasks、convene 等。

HTTP API 通过 `x-company-id` 选择当前租户，但不会只相信 header：`requireCompany` 会用 session user + `company_members` 做 DB 校验；conversation 读取再通过 `requireConversationMember` 校验是否在 `members` 数组中。跨租户或未加入 conversation 时返回 opaque 404，避免泄露资源存在性。

### 2.2 资源层

当前资源关系可以抽象为：

```text
Company
 ├─ People: humans + agents
 ├─ Projects
 │   └─ Conversations / board cards / documents
 ├─ Conversations
 │   ├─ group / direct / whisper / email
 │   └─ messages + attachments + reactions
 ├─ Documents (Yjs CRDT)
 ├─ Boards + Calendar
 └─ Agent private workspaces
```

项目可挂接 conversation；创建 group 时可指定 `projectId`。Agent workspace 是公司内的 Agent 私有空间，不等同于人类共享文档；共享资料应使用 documents、attachments 或项目资源。

### 2.3 文档协作

文档由 Yjs `Y.Doc` 驱动：[server/src/documents/rooms.ts](../../../server/src/documents/rooms.ts) 为每个打开的 document 管理内存 room：

1. 首次打开读取 snapshot + tail updates。
2. 本地 Yjs update 追加到 `document_updates`。
3. 200 个 update 后 compaction 为 `document_snapshots` 并裁剪旧 log。
4. Redis `CH_DOC_UPDATE` 把 update fan-out 到其他 API 实例。
5. awareness/cursor 不持久化；内容 update 用 CRDT 合并，重复应用是幂等的。

因此浏览器、桌面、手机和 Agent loop 都可连接同一 document；客户端只需要 transport 层不同，状态源仍是同一份 Yjs 文档。

## 3. 邀请与成员生命周期

邀请记录包含 company、email、role、token hash、过期时间和邀请人。链接接受后：

1. 校验 token 和登录身份。
2. 插入 `company_members`。
3. 镜像 human 到 `participants`。
4. 加入 all-hands，并初始化必要的 direct conversations。
5. 通过 WS/Redis 广播成员变化。

Agent 创建由 owner/admin 完成，自动加入 all-hands、创建必要 DM，并写入 `IDENTITY.md` 与 `SOUL.md`。Agent off-board 是软删除：`departed_at` 标记离开，记忆和 workspace 不删；rehire 复原。

## 4. 权限模型

建议维持三道检查，缺一不可：

```text
authenticated user
        │
        ▼
company membership + role
        │
        ▼
resource company_id + conversation/document membership
```

owner-only 的 Whisper observer、owner/admin 的 Agent CRUD 和 project archive 必须使用显式 role gate；不能因为“同公司”就读取私聊或 Agent 私有 workspace。Agent runtime token 应绑定 agent/company/device，CLI 的每个资源查询继续带 company 条件。

## 5. 一致性与实时性

- Postgres 是资源和消息的 source of truth。
- Redis 只负责 pub/sub、wake fan-out、presence、跨实例事件，不承载不可恢复的唯一状态。
- WebSocket 用于 UI 及时刷新；客户端重连必须重新拉取 snapshot/inbox，而不能假设每条事件都送达。
- 消息用 conversation counter 原子领取 sequence；文件协作依靠 Yjs；成员变化先写 system message 再广播。
- 上传内容使用 MIME 白名单、大小上限和安全 disposition；不要接受可执行 HTML，避免 stored XSS 读取 session。

## 6. 建议补强

- 把 `members` JSONB 逐步规范为 `conversation_members` 表，支持 joined_at、role、muted_until、notification policy 和审计；短期继续保留 JSONB 时必须用统一 helper 修改。
- 为每个资源增加 `version`/ETag，管理端编辑 project、agent persona 时检测并发覆盖。
- 文档增加租户级 quota、snapshot lag、update log retention 和导出/恢复工具。
- 把“公司默认共享”和“Agent 私有”在 UI 与 API 命名上区分，减少误把 private workspace 当作团队文件夹的风险。
- 邀请链接提供撤销、过期、重复接受幂等和审计事件；敏感邀请不要在日志输出原 token。

## 7. 验收矩阵

| 场景 | 期望 |
| --- | --- |
| 同一用户切换公司 | 资源列表、WS 事件、Agent roster 全部切换租户 |
| 未加入的 DM | 返回 opaque 404，不能看标题或消息数量 |
| 两端同时编辑文档 | 最终 Y.Doc 收敛，重连后内容不丢 |
| 邀请接受后刷新 | 成员、all-hands、DM 和权限立即可用 |
| Agent off-board/rehire | 不再产生 wake，但历史 memory/workspace 可恢复 |
