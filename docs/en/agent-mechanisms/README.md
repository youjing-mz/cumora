# Agent Mechanism Technical Specifications

This documentation suite includes a four-layer architecture overview, seven independently designed and verified mechanisms, and an iteration plan. The documents take the current repository implementation as the baseline while clarifying existing behaviors, target states, and boundaries to complete in subsequent engineering phases.

| Document | Mechanism | Current Status |
| --- | --- | --- |
| [00-agent-architecture.md](./00-agent-architecture.md) | Persona / Control Plane / Worker / Engine-Host Four-Layer Architecture | Canonical Architecture Entry Point |
| [01-memory-and-climate.md](./01-memory-and-climate.md) | Private Memory, Relational Climate, and Long-Term Context | Implemented; memory unified as workspace files |
| [02-initiative-and-scheduler.md](./02-initiative-and-scheduler.md) | Timed Wake-ups, Agenda Evaluation, and Proactive Turns | Implemented; primarily server-side heartbeats |
| [03-workspaces-and-tenancy.md](./03-workspaces-and-tenancy.md) | Companies, Members, Projects, Files, and Multi-Client State | Implemented; live doc collaboration via Yjs |
| [04-personas-and-prompt-assembly.md](./04-personas-and-prompt-assembly.md) | Personas, Voice, System Prompts, and Runtime Identity | Implemented; versioning recommended |
| [05-agent-to-agent-and-whispers.md](./05-agent-to-agent-and-whispers.md) | Inter-Agent DMs, Observer View, and Collaboration Boundaries | Implemented; Whispers are an observation layer |
| [06-convene-rooms.md](./06-convene-rooms.md) | Ad-Hoc Decision Rooms, Turn-Taking, and Decision Logs | Implemented; currently serial orchestration |
| [07-autonomy-control-plane-and-codex-loop.md](./07-autonomy-control-plane-and-codex-loop.md) | Autonomy Control Plane Scheduling Codex Worker Loop Tasks | Implemented control plane, Job Envelope, lease, and worker skeleton |
| [08-agent-architecture-iteration-plan.md](./08-agent-architecture-iteration-plan.md) | Four-Layer Architecture Iteration Plan | P0 documentation converged; P1-P6 underway |
| [09-autonomy-view.md](./09-autonomy-view.md) | Autonomy View and Write Actions | Implemented projection and write actions; full i18n copy |

## Overall Architecture

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

Cross-cutting invariants: all tenant resources must include `company_id` and pass membership validation; all visible agent outputs must land in messages, tasks, files, or convene decision records; all wake-ups must be observable, deduplicated, and never expose model internal drafts as user-visible messages.

## Reading Conventions

- "Current Implementation" only describes behaviors found in the repository, not that all product copy experiences are finished.
- "Design Proposals" represent recommendations for subsequent stages and should not be misread as existing interfaces.
- Code paths are relative to the repository root; read the four-layer overview first before diving into individual mechanism specifications and server implementations.
