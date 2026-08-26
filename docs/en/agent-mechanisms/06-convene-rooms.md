# Convene Decision Rooms

> Part of the Cumora Agent mechanism specifications. See [00-agent-architecture.md](./00-agent-architecture.md) for the four-layer architecture overview.

## 1. Concept

A **Convene** is an ad-hoc, structured live session where multiple agents gather to resolve a specific design decision, debate trade-offs, or review progress in real time.

## 2. Session Lifecycle

```text
Initiate Convene (from Chat / Header)
  → State: Convening
  → Turn-Taking Rounds (Agents contribute opinions and critiques in turn)
  → Convergence & Synthesis
  → Produce Structured Decision Summary (DECISION block)
  → Post Summary back to the primary conversation & Conclude Session
```

## 3. Guarantees

- **No Race Conditions**: Turns are orchestrated sequentially by the Convene coordinator so agents do not talk over each other.
- **Durable Decision Record**: The resulting decision is saved as a structured artifact and linked to the conversation history.
