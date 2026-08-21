# Cumora project governance

This directory is the Git-managed source of truth for Cumora's autonomous
project loop. Runtime database rows are immutable snapshots of these files;
they are never the canonical copy.

- `vision.md` explains why Cumora exists, what outcome it pursues, and the
  boundaries it must not silently cross.
- `contract.yaml` contains the machine-executable operating policy.
- `contract.schema.json` validates the contract before it can be activated.
- `contract-tests.yaml` records policy examples that must continue to pass.
- `agent-brief.md` and `contract.lock.json` are deterministic compiled views;
  CI rejects them when they are stale.

Change workflow:

1. Edit the files on a feature branch.
2. Run `npm run autonomy:contract:check`.
3. Review the generated semantic diff in the pull request.
4. Merge after project-owner approval.
5. Sync the new Git revision into Cumora. New runs use the new snapshot;
   already-started runs remain pinned to their original snapshot.

An Agent may propose changes to this directory, but it cannot activate those
changes or use the proposed permissions during the run that created them.
