# 自治 Cumora 运行手册

本运行手册用于操作 [AUTONOMOUS_PROJECTS.md](./AUTONOMOUS_PROJECTS.md) 中描述的第一阶段自举闭环。Cumora 可编辑的愿景与运行契约保存在 `.cumora/` 中；PostgreSQL 仅持久化激活后的不可变快照及运行时投影。

术语遵循 [00-agent-architecture.md](./agent-mechanisms/00-agent-architecture.md)：Bram/Iris 等属于 Persona 身份，本手册面向 Autonomy Control Plane 与 Worker，Codex 属于 Worker Engine 而非隐式团队成员。

## 闭环执行流程

```text
绑定的项目会话消息
  → 幂等创建 Work Item + Shipping feature
  → 节点申领契约绑定的 CodingJob 租约
  → 隔离工作树 + builder + 可执行自动化检查
  → 独立验证人 (independent verifier) + staging 冒烟测试
  → 推送特性分支并创建 Pull Request
  → 项目所有者审批合入 (merge approval)
  → 接收带签名的 GitHub merge 事件
  → 执行生产环境部署 Job
  → 执行生产环境回读验证 Job (production readback)
  → 完成 Work Item + 标记 Shipping feature 为 Learned
```

所有状态变更均以追加方式记录在 `autonomy_events` 中。证据在 `autonomy_evidence` 中进行内容哈希校验；队列状态表为高效申领的可变投影。过期的 Worker 无法完成 Run，因为所有写操作均需要有效的当前租约 Token。

## 1. 验证 Git 治理源

```bash
npm run autonomy:contract:compile
npm run autonomy:contract:check
```

`contract.lock.json` 与 `agent-brief.md` 必须随其源文件一同提交。生产构建会自动运行此项检查，若治理产物过期则构建失败。

## 2. 初始化 Cumora 项目

执行数据库迁移后，创建或选定：
- Cumora 的 `projects` 记录；
- 关联到该项目的专用项目会话；
- 一台在线配对且运行自治 worker 的 Computer。

工作区所有者/管理员可通过以下 API 同步并激活配置：

```http
POST /api/autonomy/projects/<project-id>/sync-git
X-Company-Id: <company-id>
Authorization: Bearer <human-session>

{"revision":"<git-commit-sha>"}
```

然后绑定摄入会话与执行节点：

```http
POST /api/autonomy/projects/<project-id>/configure

{
  "mode": "execute_with_gates",
  "conversationId": "<project-conversation-id>",
  "computerId": "<paired-computer-id>"
}
```

只有在显式绑定的会话中发送的人类消息才会转化为 Work Item。

## 3. 配置项目节点与 Worker

```bash
export CUMORA_SERVER_URL=https://api.cumora.ai
export CUMORA_DEVICE_TOKEN=<paired-computer-device-token>
export CUMORA_AUTONOMY_REPOSITORY_ROOT=/srv/cumora
export CUMORA_AUTONOMY_BUILDER_COMMAND='codex exec --full-auto -'
export CUMORA_AUTONOMY_VERIFIER_COMMAND='codex exec --full-auto -'
export CUMORA_AUTONOMY_STAGING_COMMAND='<deploy staging and run user-path smoke>'
export CUMORA_AUTONOMY_PRODUCTION_COMMAND='<deploy the merged revision and smoke>'
export CUMORA_AUTONOMY_READBACK_COMMAND='<query production health and exit nonzero on regression>'
export CUMORA_AUTONOMY_PUSH_BRANCH=1
export GITHUB_TOKEN=<short-lived-repository-token>

npm run autonomy:worker
```

Builder 与 Verifier 必须使用不同的身份与模型会话。若 `independent_verification` 的产出者与 Builder 相同，控制面将直接拒绝。

## 4. 本地端到端测试

在接入生产基础设施前，可在本地一键运行完整闭环测试：

```bash
npm run test:e2e
```

测试套件将验证闭环能否成功到达 `git.merge_master` 审批、正确记录执行绑定并完成部署与回读。
