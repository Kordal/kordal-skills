# Claude: implementation

Read [workflow.md](workflow.md), the task's plan and its ADRs. Delivery is local: nothing is pushed until the whole MVP is done, and no reviewer signs off a task.

```bash
node scripts/agent-local.mjs next          # what is ready, claimed, waiting
node scripts/agent-local.mjs claim <ID>    # creates task/<id> from the integration branch
git switch task/<id>
# implement the complete acceptance slice; commit
node scripts/agent-local.mjs gate          # make pr-check, recorded for the commit
# record evidence and screenshots, move the plan to completed/; commit
node scripts/agent-local.mjs finish <ID>   # fast-forwards the integration branch
# give the owner the status update
```

Before `finish`, check every acceptance criterion against evidence you produced, and read your own diff as a reviewer would: contracts, migrations, failure paths, permissions and cross-component behaviour. Record deviations and follow-up work in Completion Notes.

Do not push, open a pull request or commit to the integration branch directly. When every task is on it, follow "Owner acceptance" in the workflow; push only after the owner has accepted the MVP.
