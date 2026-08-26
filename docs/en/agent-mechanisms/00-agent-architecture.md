# Cumora Agent Architecture Overview

> This document is the canonical architecture entry point for Cumora Agent terminology, responsibility boundaries, and interaction models. When discussing subsystems, other documents must follow the definitions in this document without redefining "Cloud Agent" or "Worker Agent".

## 1. Architectural Decisions

Cumora decomposes the Agent system into four orthogonal layers:

```text
Persona
  Who is judging and expressing?
  e.g., Bram, Iris, Atlas, Nova

Control Plane
  Who decides task state, permissions, scheduling, and evidence?
  e.g., Autonomy Coordinator

Worker
  Who actually executes this specific task or Attempt?
  e.g., Codex Builder, Independent Verifier, Deployment Worker

Engine / Host
  What reasoning engine is used, and where is it running?
  e.g., Codex on Mac, managed on Cumora Cloud
```

These four layers are not four different brands of agents, but answers to four distinct questions. A Persona can use different Engines across different Hosts; an autonomous Run can assign a Persona as responsible while being executed by an independent Worker; the Control Plane bounds the loop without impersonating a Persona or executing arbitrary code directly.

## 2. Standard Terminology

| Term | Precise Definition | In Team Roster | Primary Vehicle |
| --- | --- | --- | --- |
| Persona Agent | A teammate with name, role, voice, memory, and long-term relationships | Yes | `participants`, `agent_workspace` |
| Autonomy Control Plane | Manages Work Items, Runs, policies, leases, Evidence, and Approvals | No | `autonomy/*` services + Postgres |
| Worker | Process or entity executing a bounded Job/Attempt | Default No | `autonomy-worker`, Codex/Claude command |
| Engine | Implementation generating reasoning and tool calls | No | `managed`, `codex`, `claude`, `grok` |
| Host / Computer | Machine or managed environment hosting Engines and workspaces | Infrastructure UI | `computers` |
| Cumora Cloud Runtime | Managed Computer and per-agent pods provided by Cumora | No | Cloud computer + `turn.ts` |
| Job Envelope | Immutable task boundary sent by the Control Plane to a Worker | No | `autonomy_runs.job_envelope` |
| Run / Attempt | Resumable, auditable single task execution | State projection | `autonomy_runs`, `autonomy_events` |

### 2.1 Deprecated Terms

- Do not use **Cloud Agent** to refer simultaneously to hosted agents, the control plane, and planners.
- Do not treat **Codex** by default as a team member. Codex is an Engine or Worker; it is only a roster identity if a Persona is explicitly created for it.
- Do not use **Agent** loosely to refer to state machines, daemons, models, personas, and workers alike.

## 3. Four-Layer Responsibilities

### 3.1 Persona: Judgment and Expression
Persona agents hold human-facing names, avatars, biographies, and system prompts. They interact in team channels, maintain long-term memory, and build relationship climate with teammates.

### 3.2 Control Plane: State and Governance
The Autonomy Control Plane reconciles repository governance policies, schedules Work Items into Runs, issues leases, enforces independent verification requirements, and creates human Approval Requests.

### 3.3 Worker: Isolated Execution
Workers execute single attempts within sandboxed worktrees. They obey the Job Envelope and produce structured evidence without holding long-term conversational memory.

### 3.4 Engine / Host: Compute and Environment
The Engine provides raw LLM inference and tool calling, while the Host provides the compute environment (MacBook, VPS, or Kubernetes cluster).

## 4. Documentation Navigation

- [04-personas-and-prompt-assembly.md](./04-personas-and-prompt-assembly.md): Persona identity and prompt assembly.
- [07-autonomy-control-plane-and-codex-loop.md](./07-autonomy-control-plane-and-codex-loop.md): Control plane and Worker sequence for typical Loop Tasks.
- [08-agent-architecture-iteration-plan.md](./08-agent-architecture-iteration-plan.md): Phased plan to evolve towards the four-layer model.
- [09-autonomy-view.md](./09-autonomy-view.md): Autonomy view and write actions.
- [BYOA.md](../BYOA.md): Engine/Host operating model for Personas.
- [AUTONOMOUS_PROJECTS.md](../AUTONOMOUS_PROJECTS.md): Autonomous project state machine, policies, and evidence model.
- [AUTONOMY_RUNBOOK.md](../AUTONOMY_RUNBOOK.md): Self-hosting delivery loop operations manual.
