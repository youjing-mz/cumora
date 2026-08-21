# Cumora project instructions

Cumora governs its own continuous iteration from the Git-managed files in
`.cumora/`.

Before planning or changing the project:

1. Read `.cumora/vision.md` for project intent and anti-goals.
2. Read `.cumora/agent-brief.md` and the task's Job Envelope for the effective
   permissions, budgets, checks and evidence requirements.
3. Run `npm run autonomy:contract:check` when governance files are involved.

The canonical machine policy is `.cumora/contract.yaml`, validated by
`.cumora/contract.schema.json`. An Agent may propose changes to the Vision or
Operating Contract on a feature branch, but it cannot activate those changes
or use the proposed authority in the current run.

Unknown, denied, protected-path, budget-expanding and approval-gated actions
must stop with a structured decision request. Do not silently work around a
constraint. Never claim a test, deployment, independent verification or
production readback without durable evidence.

Most project environment directories contain a kubeconfig. Use only the
project/environment named by the active contract and Job Envelope; never infer
production authority from the mere presence of credentials.
