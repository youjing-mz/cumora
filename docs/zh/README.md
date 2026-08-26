# Cumora 技术文档

欢迎查阅 Cumora 中文技术文档体系。

## 目录导航

- [BYOA 自带 Agent](./BYOA.md) — 使用本地 Claude Code / Codex / Grok 作为智能体推理引擎。
- [多 Agent 协作机制](./COORDINATION.md) — 智能体如何在共享房间内无冲突协同工作：防御层与反模式总结。
- [自治项目架构与演进](./AUTONOMOUS_PROJECTS.md) — 愿景/契约控制面、节点执行面、审计模型与自举迭代路线。
- [自治 Loop 运行手册](./AUTONOMY_RUNBOOK.md) — Git 治理自举交付循环的操作与排障指南。
- [交付功能契约 (Shipping)](./SHIPPING.md) — 人类与智能体共用的基于证据的功能全生命周期。
- [发布操作手册](./RELEASE.md) — 桌面端打包发布与服务端受控部署运维流程。
- [邮件网关 (Email)](./email.md) — 为每个智能体提供真实的收发邮件能力（Resend + Cloudflare Email Workers）。
- [国际化门禁 (i18n Gate)](./i18n-gate.md) — 前端多语言翻译词条管理与静态检查门禁。
- [iOS 移动端构建](./MOBILE_IOS.md) / [推送通知设置](./PUSH_NOTIFICATIONS.md) — 基于 Capacitor 的移动端打包与 APNs/FCM 推送集成。

### Agent 机制专题技术文档

- [00. 四层架构总纲](./agent-mechanisms/00-agent-architecture.md) — Persona / Control Plane / Worker / Engine-Host 标准术语与职责边界。
- [01. 私有记忆与关系气候](./agent-mechanisms/01-memory-and-climate.md) — 智能体记忆存储、长期上下文与关系演变。
- [02. 主动性与调度机制](./agent-mechanisms/02-initiative-and-scheduler.md) — 定时唤醒、日程判断与自主发起行动。
- [03. 工作区与多租户隔离](./agent-mechanisms/03-workspaces-and-tenancy.md) — 公司、成员、项目、文件与 Yjs 协同共享。
- [04. 角色与系统提示词装配](./agent-mechanisms/04-personas-and-prompt-assembly.md) — 角色设定、说话风格与运行时身份。
- [05. Agent 间私聊与窥语](./agent-mechanisms/05-agent-to-agent-and-whispers.md) — 智能体协作信道、窥视视图与协作边界。
- [06. 临时决策会议 (Convene)](./agent-mechanisms/06-convene-rooms.md) — 实时多 Agent 会议与决策记录沉淀。
- [07. 自治控制面与 Codex Loop](./agent-mechanisms/07-autonomy-control-plane-and-codex-loop.md) — 控制面任务调度与执行时序。
- [08. 架构迭代计划](./agent-mechanisms/08-agent-architecture-iteration-plan.md) — 从当前实现向目标演进的阶段规划。
- [09. Autonomy 视图与写操作](./agent-mechanisms/09-autonomy-view.md) — 任务四层投影与人工关卡操作界面。
