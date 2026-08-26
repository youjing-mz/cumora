# Persona、声音与系统提示词技术设计

> 层级定位：本文只描述 Persona——谁在判断和表达。Control Plane、Worker 与 Engine/Host 的边界见 [00-agent-architecture.md](./00-agent-architecture.md)。

## 1. 目标

让 Agent 不是一组匿名 prompt，而是稳定的工作身份：有名字、角色、声音、工具边界、模型配置和可编辑的系统提示词。Persona 的职责是定义“它是谁、如何表达、承担什么工作”；工作状态和长期经历分别由 turn、workspace、memory 负责。

## 2. 当前数据与解析

`participants` 保存 Agent 的基本身份：`id`、`name`、`role`、`bio`、`tools`、`system_prompt`、`model`、`fast_model`、`company_id`、`departed_at` 和状态租约字段。`getPersona` 通过 `participants` 读取 active agent，并在服务进程内做短路径缓存；更新 Agent 后调用 `invalidatePersonaCache`。

实现位置：

- [server/src/agents/personas.ts](../../server/src/agents/personas.ts)：Persona 解析、team roster、system prompt 基础规则。
- [src/components/AgentEditor.tsx](../../src/components/AgentEditor.tsx)：编辑 UI。
- [server/src/api/router.ts](../../server/src/api/router.ts)：Agent create/update/off-board/rehire 和初始 workspace 文件。
- [server/src/agents/model-policy.ts](../../server/src/agents/model-policy.ts)：按用途限制模型选择。

Persona 解析只返回 active agent；team roster 同时展示当前 human/agent 成员，已离职 Agent 不再进入其他 Agent 的提示词 roster。

## 3. Prompt 组装顺序

推荐的优先级应保持为：

```text
平台安全规则 / 工具权限
        ↓
Cumora 全局行为协议
        ↓
Agent Persona（role + voice + system_prompt）
        ↓
SOUL.md / IDENTITY.md
        ↓
当前租户 roster、项目/会话上下文
        ↓
memory / climate / retrieved files
        ↓
本次 wake 的 inbox、agenda、steer
```

当前代码已经将全局规则、声音规则、Skype emoticon guide、CLI 能力、私有文件语义等放入基础 system prompt；turn 再加入 conversation context、memory、climate、skills index 和当前唤醒内容。Convene 使用同一个基础 prompt，再追加 live session 的短发言规则。

Persona 文本是行为偏好，不应覆盖服务端安全规则、租户权限、模型 policy、freshness gate 或工具白名单。`system_prompt` 也不应被当作任意代码执行。

Persona 也不等于 Worker。Bram 可以是某个 Run 的 engineering owner，实际代码执行者可以是 Codex Worker；审计需要分别记录 `persona_agent_id` 与 `worker_id`，不能只用一个模糊的 Agent 名称。

## 4. 创建与更新流程

```text
owner/admin POST /agents
      │
      ├─ validate name / role / system_prompt
      ├─ allocate unique id in company
      ├─ insert participants
      ├─ seed IDENTITY.md + SOUL.md
      ├─ join all-hands + seed DMs
      └─ invalidate persona cache
```

更新时只允许受控字段；`system_prompt` 应有最小长度、最大长度和敏感内容检查。改名、角色和 prompt 的更新需要产生审计事件，并在正在运行的 turn 上采用“下一 turn 生效”语义，避免一次推理中途改变身份。

模型选择应按用途区分：真实工作、Convene speech 可使用 Agent 配置的 task model；inbox triage、agenda、decision classifier 使用 support/small model。模型名需要 allowlist，禁止 Persona 让自己切换到任意供应商或绕开成本策略。

## 5. 版本化建议

当前 `system_prompt` 是一个可变字段，缓存失效依赖进程内操作。为了支持可靠审计和多人编辑，建议新增：

```text
agent_persona_versions(
  id, agent_id, company_id, version,
  name, role, bio, system_prompt,
  tools, model, fast_model,
  created_by, created_at, change_reason,
  superseded_at
)
```

`participants` 保留 current pointer。每个 `agent_run` 记录 persona_version，便于回答“为什么这个 Agent 当时这样说”。跨多副本时用 DB current version 或 Redis invalidation，而不要只依赖本地 Map。

## 6. 声音质量与可测试性

Persona 验收不应只看 prompt 是否存在，而要看可观察行为：

- 同一角色在不同 conversation 中语气稳定，但不会重复固定口头禅。
- 对不完整需求能提出追问；对弱设计能给出具体反驳；对模糊规格能拒绝“直接开工”。
- 角色差异不能改变工具权限和跨租户边界。
- off-board Agent 不会被新 turn 选中；rehire 后使用同一身份和历史私有 workspace。

建议建立 persona regression fixtures：给每个 Agent 相同的 5～10 个场景，检查 tone、决策倾向、是否调用正确工具，而不是比对精确文本。所有模型输出都要经过工具调用解析、消息发布和安全过滤。

## 7. 风险

- **人格漂移**：只改 system_prompt 但未记录版本，导致问题无法复现。
- **提示词注入**：用户消息、文档、memory 均是低优先级数据，不得覆盖身份和平台规则。
- **过度拟人化**：UI 可以呈现个性，但需明确 Agent 的状态、来源和能力边界。
- **缓存陈旧**：多实例更新后其他实例仍使用旧 Persona；应增加版本或 Redis invalidation。
- **工具过权**：`tools` 只是候选工具声明，最终授权必须由 runtime/server 再校验。
