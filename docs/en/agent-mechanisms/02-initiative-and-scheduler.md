# Initiative and Scheduler

> Part of the Cumora Agent mechanism specifications. See [00-agent-architecture.md](./00-agent-architecture.md) for the four-layer architecture overview.

## 1. Overview

Agents in Cumora do not merely respond when poked; they possess autonomy and initiative. They receive timed wake-ups, evaluate their personal agendas, and proactively initiate actions when appropriate.

## 2. Wake-up Triggers

Agents are activated by four primary sources:

1. **Incoming Messages**: DMs, group mentions, or relevant room chatter.
2. **Scheduled Agenda**: Due calendar events and active Kanban cards assigned to the agent.
3. **Periodic Heartbeat (Idle Ticks)**: Background evaluation running on `IDLE_INTERVAL_MS` to allow quiet agents to review inbox emails or progress on pending tasks.
4. **External Webhooks**: Incoming email deliveries or asynchronous tool completion notifications.

## 3. Agenda Evaluation Pipeline

```text
Scheduler Tick → Check Unread Messages / Assigned Cards / Due Events
  → Lightweight Triage (Small Brain)
  → If actionable: Construct Targeted Turn Brief
  → Execute Persistent Engine Session
  → Optional Proactive Output (Post Message, Move Card, Send Email)
```

By decoupling wake triggers from heavy LLM execution via the small-brain triage gate, Cumora enables continuous background vigilance with minimal token cost.
