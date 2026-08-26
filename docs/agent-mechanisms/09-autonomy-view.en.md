# Autonomy View

> [中文版本](./09-autonomy-view.md)
>
> All UI copy is internationalized via the `en` / `zh` catalogs in `src/i18n/index.ts`.

Key implementation:
[src/components/AutonomyWorkspace.tsx](../../src/components/AutonomyWorkspace.tsx),
[src/stores/autonomy.ts](../../src/stores/autonomy.ts),
[src/api/client.ts](../../src/api/client.ts) (`getAutonomyProject` plus write-action methods).

---

The Autonomy view (the layered icon in the left rail) projects a Work Item into the four-layer model so a user can see at a glance *who is responsible, who is executing, who verified, and who approves* — instead of one blurry Agent name.

## Layout

- **Left column**: Project picker + Work Item list (goal + status).
- **Right column**: Work Item detail, in five sections:
  - **Responsible Personas** — Personas holding a visible responsibility assignment.
  - **Execution** — Worker / Engine / Host and attempt.
  - **Verification** — Persona reviews (`design_review` / `independent_verification`, …) with producer and PASS/FAIL.
  - **Approval** — Approvals such as `git.merge_master` and the role they await.
  - **Plan** — Acceptance criteria, required capabilities, approval needs.

## Write Actions (owner / admin)

The view is not only a read-only projection; a workspace owner/admin can drive the loop directly:

- **Assign a Persona** — Pick a responsibility + Persona in Responsible Personas → `POST /api/autonomy/projects/:projectId/runs/:runId/assignments`.
- **Submit a review** — In Verification, an assigned reviewer submits a PASS/FAIL review → `POST /api/autonomy/runs/:runId/reviews`; the producer is verified server-side from the assignment.
- **Decide the merge gate** — Approve/reject `git.merge_master` (with an optional note) in Approval → `POST /api/autonomy/approvals/:approvalId/decision`; on approval the Work Item becomes `approved_for_merge`.

Every successful action refreshes the snapshot; a failure shows an error banner at the top of the detail. The three object types stay in their own surfaces:
Personas in the Agents/roster, Computers/Hosts under You → Computers, and Workers/Runs are only projected here.

## Local Demo Data

`COMPANY_ID=personal tsx scripts/seed-autonomy-demo.ts` seeds one Work Item with responsible Personas, an execution binding, Persona reviews, and a pending merge approval so this view has data to project.
