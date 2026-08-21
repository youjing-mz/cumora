# Autonomous Cumora runbook

This runbook operates the first self-hosting loop described in
[`AUTONOMOUS_PROJECTS.md`](AUTONOMOUS_PROJECTS.md). Cumora's editable Vision
and Operating Contract live in [`.cumora/`](../.cumora/); PostgreSQL contains
activated immutable snapshots and runtime projections only.

## What the first loop does

```text
bound project message
  → idempotent Work Item + Shipping feature
  → node claims a contract-pinned CodingJob lease
  → isolated worktree + builder + executable checks
  → independent verifier + staging smoke
  → pushed feature branch + pull request
  → project-owner merge approval
  → signed GitHub merge event
  → production deployment job
  → production readback job
  → completed Work Item + learned Shipping feature
```

Every state change is appended to `autonomy_events`. Evidence is content-hashed
in `autonomy_evidence`; queue tables are mutable projections for efficient
claiming. A stale worker cannot complete a run because every write requires the
current lease token.

## 1. Validate the Git governance source

```bash
npm run autonomy:contract:compile
npm run autonomy:contract:check
```

`contract.lock.json` and `agent-brief.md` must be committed with their sources.
The normal production build runs the check and fails on stale artifacts.

Governance changes use the normal feature-branch review flow. Increment
`metadata.version` for a semantic policy change. An Agent may author the diff,
but a project owner must merge it before it can be synchronized and activated.

## 2. Bootstrap the Cumora project

Run database migration, then create or select:

- the Cumora `projects` row;
- a dedicated project conversation attached to that project;
- an online paired Computer that will run the autonomy worker.

As a workspace owner/admin, activate the files baked into the current server
revision:

```http
POST /api/autonomy/projects/<project-id>/sync-git
X-Company-Id: <company-id>
Authorization: Bearer <human-session>

{"revision":"<git-commit-sha>"}
```

Then bind the intake conversation and execution Computer:

```http
POST /api/autonomy/projects/<project-id>/configure

{
  "mode": "execute_with_gates",
  "conversationId": "<project-conversation-id>",
  "computerId": "<paired-computer-id>"
}
```

Only human messages in this explicitly bound conversation become Work Items.
`observe` and `propose` modes never schedule coding jobs. Set `paused:true` to
stop new work without losing running history.

## 3. Configure the project node

The node must have a clean Cumora checkout, Git push credentials, a paired
Computer device token, two independent Agent commands, and contracted
staging/production adapters.

```bash
export CUMORA_SERVER_URL=https://api.cumora.ai
export CUMORA_DEVICE_TOKEN=<paired-computer-device-token>
export CUMORA_AUTONOMY_REPOSITORY_ROOT=/srv/cumora
export CUMORA_AUTONOMY_BUILDER_COMMAND='codex exec --full-auto -'
export CUMORA_AUTONOMY_VERIFIER_COMMAND='codex exec --full-auto -'
export CUMORA_AUTONOMY_STAGING_COMMAND='<deploy staging and run user-path smoke>'
export CUMORA_AUTONOMY_PRODUCTION_COMMAND='<deploy the merged revision and smoke>'
export CUMORA_AUTONOMY_READBACK_COMMAND='<query production health and exit nonzero on regression>'
export CUMORA_AUTONOMY_PUSH_BRANCH=1
export GITHUB_TOKEN=<short-lived-repository-token>

npm run autonomy:worker
```

Use different Agent identities and preferably fresh isolated model sessions for
builder and verifier. The control plane rejects
`independent_verification` when its producer is the builder.

The worker never receives merge permission. It can push the contracted feature
branch and create a pull request; protected-branch policy remains in GitHub and
the Cumora Approval Request.

## 4. Configure the merge webhook

Set the same high-entropy secret in Cumora and the GitHub repository webhook:

```bash
CUMORA_GITHUB_WEBHOOK_SECRET=<random-secret>
```

- URL: `https://api.cumora.ai/webhooks/github/autonomy`
- Content type: `application/json`
- Event: Pull requests
- Secret: the value above

Cumora verifies `X-Hub-Signature-256`. Only a merged PR whose head branch and
repository match an `approved_for_merge` Work Item can create a production job.
For Git providers without a webhook Adapter, an owner can use the audited
fallback `POST /api/autonomy/work-items/<id>/merged` with the merge commit SHA.

## 5. Operate and audit

```http
GET /api/autonomy/projects/<project-id>
```

The snapshot returns project governance hashes, Work Items, pending/decided
approvals and the most recent append-only events. Shipping contains the
corresponding evidence squares and production release/readback record.

Important recovery behavior:

- Expired leases return to the queue with a new fencing token.
- Repeating the same message or manual idempotency key does not create a second
  Work Item.
- Missing evidence moves the run to `awaiting_evidence`; it does not advance.
- A blocked adapter records `blocked` with its reason instead of claiming
  deployment or verification succeeded.
- The project owner can pause the project immediately; Git and production
  branch protections remain the final kill switches.

## 6. First dogfood acceptance

Send `修复会话重复` in the bound Cumora project conversation. Acceptance is:

1. one Work Item and one implementation Run are created;
2. the node produces a scoped PR with required checks, independent verification
   and staging smoke evidence;
3. Cumora stops at a visible `git.merge_master` Approval Request;
4. approving and merging the PR queues production automatically;
5. deployment and readback evidence complete the Work Item;
6. the entire decision chain is replayable from the project autonomy snapshot
   and Shipping workspace.

Do not treat a test runner or manually inserted evidence as production
acceptance. Missing Codex, GitHub or environment capabilities must leave the
run blocked until the node is prepared.
