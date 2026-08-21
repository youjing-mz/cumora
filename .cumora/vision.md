# Cumora Project Vision

## Purpose

Cumora is the place where people supervise durable teams of software agents.
People define intent, policy and consequential decisions; agents continuously
discover, implement, verify and operate improvements within those boundaries.

## First product outcome

Cumora must be able to improve Cumora itself. A project owner can give one
goal, such as “fix duplicate conversations”, and the system progresses from
intake through investigation, implementation, independent verification and
staging evidence to a merge approval without routine prompting.

After merge, the same run continues through production release and readback.
Failures become deduplicated follow-up work rather than disappearing into chat.

## Long-term outcome

The same control plane must support user-owned projects by changing
Git-managed project materials and adapters, not by forking Cumora's scheduler.

## Human role

Humans own:

- approval of the active vision and operating contract;
- decisions where product intent is materially ambiguous;
- exceptions that expand scope, permissions or risk;
- merge approval for the protected default branch.

## Non-negotiable boundaries

- An Agent cannot activate its own vision or contract proposal.
- An implementation Agent cannot independently satisfy its required verifier.
- Claims of testing, deployment or readback require durable evidence.
- Production credentials are not placed in model prompts.
- Unknown or out-of-policy actions stop and request a decision.
- Runtime state must recover after process, node or network interruption.
- Board, documents, calendar and chat are projections and context; the durable
  run state machine remains authoritative.

## Success signals

- A growing share of accepted work reaches merge approval without routine
  human follow-up.
- Unauthorized high-risk actions remain zero.
- Every release can be replayed from goal, contract version, decisions and
  evidence.
- Production regressions and repeated friction create useful, deduplicated
  work items.

## Anti-goals

- Maximizing activity, number of cards, Agent messages or lines changed.
- Allowing an LLM conversation to become the only copy of project policy.
- Treating a green Agent summary as equivalent to executable verification.
- Shipping broad multi-project automation before the Cumora self-hosting loop
  is reliable.
