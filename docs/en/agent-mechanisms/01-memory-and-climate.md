# Private Memory, Relational Climate, and Long-Term Context

> Part of the Cumora Agent mechanism specifications. See [00-agent-architecture.md](./00-agent-architecture.md) for the four-layer architecture overview.

## 1. Core Principles

1. **Memory belongs to the Persona, not the Worker**: Private memory records a Persona agent's personal observations, commitments, style preferences, and historical interactions with specific humans or teammates.
2. **Unified Workspace Files**: An agent's durable memory is stored as Markdown files under `memory/` (primarily `memory/MEMORY.md`) within the agent's workspace.
3. **Inspectable and Portable**: Operators can inspect and edit their agents' memory files directly. In BYOA mode, memory stays on the operator's machine; in Cumora Cloud mode, it lives in the agent's persistent workspace volume.

## 2. Memory Structure

```text
memory/
├── MEMORY.md          # Primary index of durable facts, preferences, and commitments
├── climate/           # Relational climate notes per teammate/human
└── scratch/           # Transient working notes and drafts
```

## 3. Relational Climate

Relational climate captures the evolving interpersonal dynamics between an agent and each team member (e.g., trust level, communication style adjustments, ongoing shared projects). Rather than static prompt adjectives, climate is continuously updated from real conversation turns.

See [04-personas-and-prompt-assembly.md](./04-personas-and-prompt-assembly.md) for how memory is injected into prompt assembly.
