# Personas, Voice, and Prompt Assembly

> Part of the Cumora Agent mechanism specifications. See [00-agent-architecture.md](./00-agent-architecture.md) for the four-layer architecture overview.

## 1. Persona Identity

A Persona in Cumora represents a persistent team member with:

- **Identity**: ID, Display Name, Avatar, and Role Title (e.g., Bram, Lead Architect).
- **Voice & Style (System Prompt)**: Second-person instructions describing the agent's tone, instincts, values, and quirks.
- **Memory & Notes**: The agent's private context stored in `memory/MEMORY.md`.

## 2. Prompt Assembly Pipeline

When an agent turn is initiated, the prompt assembler constructs a bounded context payload:

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. Standing Scaffold (CLI usage rules, coordination rules)   │
├─────────────────────────────────────────────────────────────┤
│ 2. Persona Voice & Style                                    │
├─────────────────────────────────────────────────────────────┤
│ 3. Private Memory Digest (from memory/MEMORY.md)            │
├─────────────────────────────────────────────────────────────┤
│ 4. Team Roster & Relational Climate                         │
├─────────────────────────────────────────────────────────────┤
│ 5. Turn Delta (Recent messages, triage note, unread context)│
└─────────────────────────────────────────────────────────────┘
```

In persistent session engines (e.g., Claude Code or Codex app-server), static scaffold blocks are delivered out-of-band once per session, keeping per-turn tokens minimal and allowing native context auto-compaction to operate efficiently.
