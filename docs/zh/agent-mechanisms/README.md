# Agent 机制技术文档

这组文档包含一份四层架构总纲、七个可独立设计和验收的机制，以及一份迭代计划。文档以当前仓库实现为基线，同时明确哪些行为已经存在、哪些仍属于目标状态，以及后续工程化时需要补齐的边界。

| 文档 | 机制 | 当前状态 |
| --- | --- | --- |
| [00-agent-architecture.md](./00-agent-architecture.md) | Persona / Control Plane / Worker / Engine-Host 四层总纲 | 规范性架构入口 |
| [01-memory-and-climate.md](./01-memory-and-climate.md) | 私有记忆、关系气候与长期上下文 | 已实现，记忆已统一为 workspace 文件 |
| [02-initiative-and-scheduler.md](./02-initiative-and-scheduler.md) | 定时唤醒、agenda 判断与主动发起 | 已实现，主要是服务端 heartbeat |
| [03-workspaces-and-tenancy.md](./03-workspaces-and-tenancy.md) | 公司、成员、项目、文件与多端共享状态 | 已实现，文档协作使用 Yjs |
| [04-personas-and-prompt-assembly.md](./04-personas-and-prompt-assembly.md) | 角色、声音、系统提示词与运行时身份 | 已实现，仍建议补版本化 |
| [05-agent-to-agent-and-whispers.md](./05-agent-to-agent-and-whispers.md) | Agent 间 DM、观察视图与协作边界 | 已实现，Whisper 是观察层而非新传输协议 |
| [06-convene-rooms.md](./06-convene-rooms.md) | 临时决策会议、轮流发言与决策记录 | 已实现，当前为串行编排 |
| [07-autonomy-control-plane-and-codex-loop.md](./07-autonomy-control-plane-and-codex-loop.md) | Autonomy Control Plane 调度 Codex Worker 的 Loop Task | 已有控制面、Job Envelope、lease 和 worker 骨架 |
| [08-agent-architecture-iteration-plan.md](./08-agent-architecture-iteration-plan.md) | 四层架构迭代计划 | P0 文档收敛已形成，P1-P6 待实现 |
| [09-autonomy-view.md](./09-autonomy-view.md) | Autonomy 视图与写操作 | 已实现投影与写操作，文案全量 i18n |

## 总体架构

```text
Persona          Bram / Iris / Atlas / Nova
       │ responsibility + visible communication
       ▼
Control Plane    work item / policy / run / lease / evidence / approval
       │ Job Envelope + assignment
       ▼
Worker           Codex builder / verifier / deployment / readback
       │ execution binding
       ▼
Engine / Host    managed or Codex/Claude on Cumora Cloud/Mac/VPS
```

横向不变量：所有租户资源都必须带 `company_id` 并经过 membership 校验；所有 Agent 产出的可见动作都应落到消息、任务、文件或会议记录中；所有唤醒都必须可观测、可去重，并且不把模型内部草稿当作用户可见消息。

## 阅读约定

- “当前实现”只描述仓库中能找到的行为，不代表产品文案中的全部体验已经完成。
- “建议补强”是实现下一阶段能力时的设计建议，不应被误读为现有接口。
- 代码路径均以仓库根目录为基准；先阅读四层总纲，再进入机制文档和服务端实现。
