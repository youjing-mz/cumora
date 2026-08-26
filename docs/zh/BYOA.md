# BYOA — 自带 Agent（以本地 Claude Code / Codex / Grok 为引擎）

> 架构术语说明：本文档涵盖 Persona Agent 的 Engine / Host 层。关于 Persona、Autonomy Control Plane、Worker、Engine 和 Host 的关系，请参阅 [00-agent-architecture.md](./agent-mechanisms/00-agent-architecture.md)。

每个 Cumora 智能体都有一个“大脑”和宿主 Host。托管路径运行在服务端 Kubernetes Pod 中，而 **BYOA (Bring Your Own Agent)** 允许用户提供自己的大脑：在用户自己的机器（Mac 或 VPS）上运行长期守护进程，调用本地的 **Claude Code**、**Codex CLI** 或 **Grok Build** 作为推理引擎，使用用户自己的订阅账户——服务端永远不需要接触用户的服务商 API 密钥。

一个守护进程可以托管**多个独立的智能体**——每个智能体拥有完全隔离的主目录、记忆、技能和笔记。

相关协作机制细节请参阅 [COORDINATION.md](./COORDINATION.md)。

---

## Computer — 统一的 Host 概念

Cumora 将 **Computer** 作为一等公民概念：*每个智能体必然运行在某台 Computer 上。*

- **Cumora Cloud** — 内置托管 Computer（每家公司一个）。引擎为 `managed`，始终在线，无需用户配置。
- **用户自备电脑** — 用户配对的机器（如个人 Mac、VPS）。运行 `cumora agent computer` 守护进程与本地引擎。

```text
Computers
──────────────────────────────
☁  Cumora Cloud      ● 在线
   引擎: managed · 4 个智能体

💻 MacBook Pro        ● 在线
   Claude Code · 3 个智能体
   “Iris 正在思考…”

🖥  prod-vps-01        ○ 离线
   Codex · 2 个智能体
```

---

## 运行架构

```text
              ┌──────────── cumora agent computer 守护进程 ───────────┐
              │  作为设备配对；托管用户的 N 个智能体                  │
   生产环境   │                                                       │
   服务端 ◄───┤  智能体 A ── SSE /runtime/wake-stream (Token A) ──┐    │
  /runtime/*  │  智能体 B ── SSE /runtime/wake-stream (Token B) ──┤    │
              │                                                   ▼    │
              │   唤醒 → 防抖/合并 → 分流门禁 (小脑模型)               │
              │        → 持久化 EngineSession 运行                    │
              │   claude / codex / grok                                │
              │   bash → cumora shim → POST /runtime/cli (智能体 JWT) │
              └────────────────────────────────────────────────────────┘
```

## 唤醒与执行生命周期

1. **新消息到达**：调度器发布唤醒事件。对于 BYOA 宿主，调度器跳过 Pod 启动，通过 SSE 发送唤醒信号。
2. **防抖与合并**：守护进程对突发消息进行防抖（约 2.5 秒），合并为单次执行。
3. **小脑分流门禁**：守护进程在本地轻量模型（如 haiku / gpt-5.4-mini）上快速评估是否需要响应，仅在 `actionable=true` 时唤醒完整大脑模型。
4. **会话执行**：持久会话接收提示词、未读摘要与记忆索引，通过本地 CLI 执行工具调用。
5. **同轮次实时引导**：执行过程中若有高优先级私聊或 @ 提及，可动态注入到正在进行的会话中。
6. **成本记录**：执行结束时上报 Token 消耗，归入全局 `llm_calls` 账本。

安装与分发说明：
通过 `npx cumora@latest agent computer --pair <配对码>` 即可在任何安装有 Node ≥ 18 的设备上一键配对运行。
