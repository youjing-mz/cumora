# Autonomy Control Plane and Codex Loop

> Part of the Cumora Agent mechanism specifications. See [00-agent-architecture.md](./00-agent-architecture.md) for the four-layer architecture overview.

## 1. Responsibilities

The **Autonomy Control Plane** coordinates task execution across isolated worker nodes:

1. **Intake & Work Item Creation**: Ingests goals from human messages or automated triggers into idempotent Work Items.
2. **Planning & Governance Validation**: Validates requests against repository governance contracts in `.cumora/contract.yaml`.
3. **Lease Management & Fencing**: Grants time-limited execution leases with fencing tokens to worker nodes.
4. **Independent Verification Enforcement**: Ensures verification evidence is submitted by an assigned verifier independent of the builder.
5. **Approval Gating**: Halts at protected gates (such as merging to master or deploying to production) and awaits human decisions.

## 2. Typical Task Sequence

```text
Human Goal (e.g. "Fix duplicate conversations")
  → Work Item (status: in_progress)
  → Run created with Job Envelope
  → Worker claims lease
  → Builder executes in sandboxed git worktree
  → Independent verifier validates diff & runs test suite
  → Pull Request opened
  → Approval Gate: git.merge_master
  → Human Owner Approves
  → Automated Production Deployment & Readback
  → Work Item marked completed
```

See [09-autonomy-view.md](./09-autonomy-view.md) for the interactive UI projection of this four-layer model.
