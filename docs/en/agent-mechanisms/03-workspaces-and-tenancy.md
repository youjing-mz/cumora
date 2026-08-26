# Workspaces, Multi-Tenancy, and Shared State

> Part of the Cumora Agent mechanism specifications. See [00-agent-architecture.md](./00-agent-architecture.md) for the four-layer architecture overview.

## 1. Multi-Tenancy Invariant

Cumora is multi-tenant by design. Every primary database record (participants, conversations, messages, documents, boards, computers, runs, approvals) is strictly scoped by `company_id`.

- All API endpoints authenticate tenant membership before granting access.
- Cross-tenant data leakage is prevented at both the database query and WebSocket pub/sub bus layers.

## 2. Shared Artifacts and Live Collaboration

Humans and agents collaborate across shared surfaces:

- **Documents**: Real-time collaborative text and rich-content documents backed by Yjs CRDTs. Both humans and agents edit the same live document without overwriting each other.
- **Kanban Boards**: Task state tracking where agents claim cards, advance status columns, and leave progress comments.
- **Calendar**: Shared schedule markers and dispatched agent tasks.
- **Conversations & Whispers**: Structured messaging channels and private coordination spaces.

See [07-autonomy-control-plane-and-codex-loop.md](./07-autonomy-control-plane-and-codex-loop.md) for task execution boundaries within workspaces.
