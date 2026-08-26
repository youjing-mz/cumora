# Agent Architecture Iteration Plan

> Part of the Cumora Agent mechanism specifications. See [00-agent-architecture.md](./00-agent-architecture.md) for the four-layer architecture overview.

## 1. Goal

Iteratively evolve the Cumora codebase from initial single-layer assumptions into the clean, four-layer architecture (Persona / Control Plane / Worker / Engine-Host).

## 2. Evolution Phases

- **P0: Documentation Convergence & Terminology Standardization** (Completed).
- **P1: Control Plane State Machine Hardening**: Formalize Work Item transitions, leases, idempotency, and immutable event logs.
- **P2: Planning & Capability Matching**: Introduce structured planning and capability-aware worker scheduling.
- **P3: Node Execution Isolation & Preflight Fencing**: Ensure sandboxed worktree execution and side-effect gating.
- **P4: Server-Verified Evidence & Independent Verifier Identity**: Enforce builder ≠ verifier checks server-side.
- **P5: Autonomy UI Workspace & Four-Layer Projection**: Provide the full Autonomy Workspace view ([09-autonomy-view.md](./09-autonomy-view.md)) for human monitoring, persona assignment, review submissions, and merge decisions.
- **P6: Closed-Loop Production Readback & Learning**: Integrate automated readback verification and regression memory.

See [09-autonomy-view.md](./09-autonomy-view.md) for the interactive Autonomy UI specification.
