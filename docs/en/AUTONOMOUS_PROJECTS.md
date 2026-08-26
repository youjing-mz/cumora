# Autonomous Projects: Architecture and Evolution Roadmap

> Status: Design Proposal
>
> Phase 1 Goal: Enable Cumora to continuously iterate on itself using this mechanism; the same mechanism can subsequently be configured for other codebase projects.

## 1. Summary

Cumora's goal is not to have users continuously issue micro-commands to multiple agents, but rather to pre-define the project vision, operating contract, environments, and permission boundaries, and let the system continuously execute:

```text
Discover Opportunities → Create Work Items → Investigate → Implement → Independent Verification → Staging Acceptance
→ Request Merge to master → Production Release → Readback → Learning → Continue Discovery
```

The human's default role is:

1. Formulate and approve the project vision and operating contract.
2. Make decisions when there is material ambiguity, risk overflow, or evidence conflicts.
3. Approve final merges to protected main branches.

The system consists of two execution planes:

- **Autonomy Control Plane**: Continuously observes the project, forms plans, executes scheduling, enforces policies, manages approvals, and audits, without executing arbitrary commands directly on production nodes.
- **Node Execution Plane**: Runs Codex, Claude Code, or other coding agents in isolated worktrees to investigate, modify, test, deploy to Staging, and gather evidence.

Boards, documents, calendars, conversations, and Shipping are not the autonomy controller itself, but shared tools, long-term context, human interaction surfaces, and runtime projection traces that agents can use. True workflow correctness is guaranteed by server-side state machines, permission policies, and evidence gates.

## 2. Goals and Non-Goals

### 2.1 Goals

- Users only need to submit a goal (e.g., "Fix duplicate conversations"), and the system advances it to awaiting merge.
- Agents proactively discover issues from errors, metrics, feedback, and runtime friction, deduplicate them into work items, and continuously process them.
- Every action, judgment, external side effect, and state transition is auditable, replayable, and attributable.
- High-risk, ambiguous, or out-of-bounds actions produce durable approval requests rather than stalling silently in chat.
- Project visions and operating contracts are versioned; agents can propose changes, but cannot activate them unilaterally.
- The Autonomy Control Plane is decoupled from node executors; projects can choose Cumora Cloud Runtime nodes or user-hosted nodes.
- Phase 1 bootstraps in the Cumora repository, and extending to subsequent projects requires no core state machine changes.

### 2.2 Non-Goals

- Do not replace permissions, state machines, leases, idempotency, or database constraints with "longer system prompts".
- Do not permit agents to explore or modify projects unboundedly without work items, evidence, or budget boundaries.
- Do not promise zero human intervention for all scenarios; the goal is to converge human attention to critical decision gates.
- Phase 1 does not support arbitrary multi-repo transactions, cross-organization release orchestration, or unassisted production data mutations.
- Board columns, chat phrasing, and self-reported agent completion cannot serve as sole proof of delivery success.

## 3. Core Principles

### 3.1 Deterministic Scaffold, Non-Deterministic Decisions

State transitions, permission checks, budgets, leases, approvals, and evidence requirements must be enforced by deterministic code. LLMs only propose plans, classifications, implementations, or suggested actions in bounded steps; they cannot bypass the state machine to declare tasks complete.

### 3.2 Separation of Intent, Policy, and Execution

- **Project Vision** answers "why we build long-term and what we strive to become".
- **Operating Contract** answers "how execution is permitted and what must be proven".
- **Work Item** answers "what changes in this iteration".
- **Execution Run** answers "who completes it, in which environment, using which contract version".

For operations guide, see [AUTONOMY_RUNBOOK.md](./AUTONOMY_RUNBOOK.md) and [00-agent-architecture.md](./agent-mechanisms/00-agent-architecture.md).
