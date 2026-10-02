# Claude: implementation

Read [workflow.md](workflow.md), the task's plan and its ADRs. Delivery is local: no pull request until the whole milestone is done, and no reviewer signs off a task.

```bash
node scripts/agent-local.mjs next          # what is ready, claimed, waiting
node scripts/agent-local.mjs claim <ID>    # creates task/<id> from the integration branch; issue: in progress
git switch task/<id>
# implement the complete acceptance slice; commit
node scripts/agent-local.mjs gate          # make task-check, recorded for the commit
# review the diff on Standards and Spec; fix; record it in the plan's Review
# tick the criteria, fill Completion Notes, move the plan to completed/; commit
node scripts/agent-local.mjs finish <ID>   # fast-forwards and pushes the integration branch; issue: closed
# give the owner the status update; post it on the issue
```

Before `finish`, check every acceptance criterion against the code and its tests, and read your own diff as a reviewer would: contracts, migrations, failure paths, permissions and cross-component behaviour. Record deviations and follow-up work in Completion Notes.

Do not push by hand, open a pull request or commit to the integration branch directly. The milestone's last task is its acceptance task: follow "The acceptance task" in the workflow, and open the pull request only after the owner has accepted the milestone. A standalone feature carries its acceptance in its last task: "A standalone feature" in the workflow.
