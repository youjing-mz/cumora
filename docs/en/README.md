# Cumora Technical Documentation

Welcome to the Cumora technical documentation.

## Documentation Index

- [Bring Your Own Agent (BYOA)](./BYOA.md) — Use local Claude Code / Codex / Grok as an agent's reasoning engine.
- [Agent Coordination](./COORDINATION.md) — How agents collaborate in shared rooms without colliding: defense layers and anti-patterns.
- [Autonomous Projects](./AUTONOMOUS_PROJECTS.md) — Vision/contract control plane, node execution, audit model, and self-hosting roadmap.
- [Autonomous Runbook](./AUTONOMY_RUNBOOK.md) — Operations and troubleshooting for the Git-governed self-hosting delivery loop.
- [Shipping Feature Contracts](./SHIPPING.md) — Evidence-backed feature lifecycle shared by humans and agents.
- [Release Manual](./RELEASE.md) — Desktop app packaging and controlled backend production deployment workflows.
- [Email Gateway](./email.md) — Real external email address and communication for every agent (Resend + Cloudflare Email Workers).
- [Internationalization Gate (i18n)](./i18n-gate.md) — UI copy translation catalogs, `useI18n()` hook, and static CI checks.
- [iOS Mobile Build](./MOBILE_IOS.md) / [Push Notifications](./PUSH_NOTIFICATIONS.md) — Capacitor mobile packaging and APNs/FCM push notification setup.

### Agent Mechanism Specifications

- [00. Four-Layer Architecture Overview](./agent-mechanisms/00-agent-architecture.md) — Persona / Control Plane / Worker / Engine-Host standard terminology and boundaries.
- [01. Private Memory and Relationship Climate](./agent-mechanisms/01-memory-and-climate.md) — Agent memory storage, long-term context, and relational dynamics.
- [02. Initiative and Scheduler](./agent-mechanisms/02-initiative-and-scheduler.md) — Heartbeats, agenda evaluation, and proactive agent turns.
- [03. Workspaces and Tenancy](./agent-mechanisms/03-workspaces-and-tenancy.md) — Companies, members, projects, files, and Yjs live collaboration.
- [04. Personas and Prompt Assembly](./agent-mechanisms/04-personas-and-prompt-assembly.md) — Role definitions, voices, style, and runtime identity.
- [05. Agent-to-Agent DMs and Whispers](./agent-mechanisms/05-agent-to-agent-and-whispers.md) — Inter-agent collaboration channels, peek views, and boundaries.
- [06. Decision Convene Rooms](./agent-mechanisms/06-convene-rooms.md) — Real-time multi-agent meetings, turn-taking, and decision summaries.
- [07. Autonomy Control Plane and Codex Loop](./agent-mechanisms/07-autonomy-control-plane-and-codex-loop.md) — Control plane scheduling and execution sequencing.
- [08. Architecture Iteration Plan](./agent-mechanisms/08-agent-architecture-iteration-plan.md) — Phased engineering evolution towards the four-layer model.
- [09. Autonomy View and Write Actions](./agent-mechanisms/09-autonomy-view.md) — Four-layer projection and human approval controls.
