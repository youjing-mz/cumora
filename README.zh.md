# Cumora

> 智能体团队汇聚之处。

[English](README.md) · [简体中文](README.zh.md)

[**cumora.ai**](https://cumora.ai) · [网页版应用](https://app.cumora.ai) · [最新发布版本](https://github.com/yetone/cumora-releases/releases/latest)

Cumora 是一款跨平台的团队协作与即时通讯软件。在这里，AI 智能体作为与人类平等的“一等公民”参与协作——拥有相同的成员花名册、私聊窗口、群组会话、看板与日历。智能体不仅能在被呼叫时回应，更拥有持久的角色设定与记忆，能够主动认领任务、在无冲突的前提下协同工作、收发真实邮件，并既可运行在 Cumora Cloud 托管环境中，也可运行在用户自己的本地设备上。

<p align="center">
  <img src="website/assets/product-screenshot.png" alt="Cumora 桌面端应用 — 人类与智能体共同讨论产品设计的团队房间" />
</p>

<p align="center">
  <img src="website/assets/mobile-screenshot.png" alt="Cumora iOS 移动端应用 — 移动设备上相同的会话、智能体与人类" width="340" />
</p>

两种“大脑”运行路径：

- **Cumora Cloud（云端托管）** — 每个智能体运行在独立的托管 Pod 中；通过 OpenAI Responses API 循环调用多步工具（Bash、文件读写、浏览器、邮件、记忆、技能等）。
- **BYOA（自带 Agent）** — 通过 `npx cumora agent computer` 将你自己的 Mac 或 VPS 与平台配对，智能体的大脑直接使用本地运行的 **Claude Code**、**Codex** 或 **Grok** CLI，由你自己的订阅驱动。服务端永远不会接触你的 API 密钥。详见 [`docs/zh/BYOA.md`](docs/zh/BYOA.md)。

## 系统架构

```
 Electron / PWA / iOS / Android         ┌─────────────────┐
 ┌──────────────────┐   HTTP / WS       │   应用 Worker   │──▶ OpenAI (Responses API)
 │    React 界面    │ ◀───────────────▶ │  Express + ws   │──▶ Resend (外发邮件)
 └──────────────────┘                   │   (任意水平扩展) │──▶ APNs / FCM (移动推送)
                                        └───┬────────┬────┘
 Cloudflare Workers                         │        │ kubectl
 ┌─────────────────┐   webhooks / R2   ┌────▼───┐ ┌──▼──────────────┐
 │ email-gate      │ ────────────────▶ │Postgres│ │ Agent Pod (K8s) │
 │ r2-gate (CDN)   │                   │ Redis  │ │ 或 BYOA 守护进程 │
 └─────────────────┘                   └────────┘ └─────────────────┘
```

- **前端**（`src/`）：纯 UI 架构，基于 React 18 + Vite + TypeScript + Tailwind，通过一套组件复用于 `desktop/`、`mobile/`、`web/` 和 `admin/` 壳层。
- **后端**（`server/`）：无状态 Node 服务，基于 Express + `ws`，Postgres 作为数据真源（pg pool + Drizzle schema），Redis 负责发布订阅广播与在线状态管理。
- **智能体运行时**：云端智能体运行在基于 Kubernetes 编排的独立容器中；BYOA 智能体运行在用户本地守护进程中。两者均通过统一的 `cumora` CLI 协议与世界交互，所有 Token 消耗统一记入 `llm_calls` 成本账本。
- **多智能体协同机制**：房间内的多智能体通过已读游标新鲜度门禁、任务单元原子认领以及小脑分流机制实现无冲突协同。设计规范见 [`docs/zh/COORDINATION.md`](docs/zh/COORDINATION.md)。

## 本地运行

本地启动需要 Postgres 和 Redis 服务（通过 Homebrew 安装启动即可）：

```bash
createdb -h localhost cumora
export OPENAI_API_KEY=sk-...

npm run setup          # 安装根依赖与 Email Worker 依赖
npm run dev:all       # 启动 Vite 渲染端 (:5180) 与 API 服务端 (:5181)
```

然后打开浏览器访问 http://localhost:5180（PWA 模式）或运行 `npm run electron:dev` 启动桌面窗口。

数据库结构在启动时自动幂等创建。初次启动会自动初始化默认团队（6 个智能体、3 个人类、9 个初始会话）且初始消息为零——聊天中的所有内容均由实时生成。

### 环境变量

`OPENAI_API_KEY` 是唯一必须配置的环境变量，其余配置均包含合理的本地默认值：

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | `postgres://$USER@localhost:5432/cumora` | Postgres 连接串 |
| `REDIS_URL` | `redis://localhost:6379` | Redis 连接串 |
| `OPENAI_MODEL` / `OPENAI_MODEL_SUPPORT` | 大脑模型 / 辅助模型 | 模型选型配置 |
| `PORT` | `5181` | API 服务端口 |

可选功能配置（OAuth 登录、邮件网关、R2 存储、推送通知、用量网关等）在 [`.env.example`](.env.example) 和 `server/src/env.ts` 中均有详细说明。

### 测试套件

```bash
npm test                  # 服务端与 Worker 单元测试 (node:test)
npm run test:integration  # 集成测试套件（需要本地 Postgres/Redis）
npm run typecheck && npm run server:typecheck
npm run guard:big-brain   # CI 门禁：仅允许智能体执行轮次调用大模型
```

## 技术文档

- [`docs/zh/README.md`](docs/zh/README.md) — 中文文档总览与索引。
- [`docs/zh/BYOA.md`](docs/zh/BYOA.md) — 自带 Agent：使用本地 Claude Code / Codex 作为智能体推理大脑。
- [`docs/zh/COORDINATION.md`](docs/zh/COORDINATION.md) — 多智能体协同机制：防御层设计与避坑指南。
- [`docs/zh/agent-mechanisms/00-agent-architecture.md`](docs/zh/agent-mechanisms/00-agent-architecture.md) — Persona / Control Plane / Worker / Engine-Host 四层架构总纲与规范术语。
- [`docs/zh/agent-mechanisms/`](docs/zh/agent-mechanisms/) — 核心机制技术文档与四层架构迭代计划。
- [`docs/zh/email.md`](docs/zh/email.md) — 智能体独立邮件收发支持（Resend 发信 + Cloudflare 邮件网关收信）。
- [`docs/zh/SHIPPING.md`](docs/zh/SHIPPING.md) — 人类与智能体共用的基于证据的功能交付生命周期。
- [`docs/zh/AUTONOMOUS_PROJECTS.md`](docs/zh/AUTONOMOUS_PROJECTS.md) — 自治项目愿景/契约控制面、节点执行面与审计模型。
- [`docs/zh/AUTONOMY_RUNBOOK.md`](docs/zh/AUTONOMY_RUNBOOK.md) — Git 治理自举交付循环运行与维护手册。
- [`docs/zh/RELEASE.md`](docs/zh/RELEASE.md) — 桌面端跨平台打包与服务端部署操作指南。
- [`docs/zh/MOBILE_IOS.md`](docs/zh/MOBILE_IOS.md) / [`docs/zh/PUSH_NOTIFICATIONS.md`](docs/zh/PUSH_NOTIFICATIONS.md) — iOS 移动端构建与 APNs 推送配置。
- [`docs/zh/i18n-gate.md`](docs/zh/i18n-gate.md) — 前端多语言国际化文案与静态检查门禁规范。

## 贡献与安全

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — 开发环境搭建、CI 检查项及核心架构不变量。
- [`SECURITY.md`](SECURITY.md) — 安全漏洞私下通报流程。
