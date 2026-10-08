# Orchestrating delivery

For the session that runs the queue, a parallel round or a gate beyond the task gate. A builder delivering one task needs none of this: [workflow.md](workflow.md) is its whole contract.

## Gates

Run a gate through the helper, on a committed, clean tree: `node scripts/agent-local.mjs gate [task-check|pr-check|premerge-check]` records the result for the commit, a failed gate records nothing, and integration checks the record.

| Gate | Stages | When |
| --- | --- | --- |
| `task-check`, the task gate | `TASK_STAGES` of the Makefile: lint, the structure check (`make structure-check`) and the tests that run in a minute or two with nothing started | every task that changes a runtime file, before it is integrated |
| `pr-check`, the full gate | `MILESTONE_STAGES` only: the slow suites, such as a clean bootstrap, acceptance, contracts and browser tests. The helper first makes sure a task gate covers the commit, running it when none does | once, by the task that completes the queue: the acceptance task |
| `premerge-check`, the resilience gate | `RESILIENCE_STAGES`: operations, backup/restore, upgrade, build and verification of the release artifacts | once, with the full gate |

- **Reuse.** A recorded gate covers every later commit until a runtime file changes: `gate` then runs nothing and says `reused` (`--force` runs it anyway). So the Review, the Notes and the owner's test document, committed after a gate, keep its result. Documentation needs no gate and keeps a recorded one, so it is checked where it is integrated: `finish` and `integrate` run the documentation check, `tests/integration/check-docs.sh`, on the commit they integrate, unless a task gate on that very commit ran it, and move nothing while a link is broken. [`scripts/agent-scope.mjs`](../../scripts/agent-scope.mjs) holds which files are runtime, and which are agent tooling.
- **Stages.** A stage is a `.PHONY` make target with a recipe: a gate refuses a stage that make has nothing to run for. A task that adds a kind of check adds its stage: to `TASK_STAGES` when it is fast, to `MILESTONE_STAGES` when it is slow. A gate without stages fails, as the full and the resilience gate of a new repository do; for those two the single word `none` (`RESILIENCE_STAGES := none`) declares the gate not applicable, which passes and is recorded as such. The task gate cannot be `none`: the helper refuses it and records nothing, and the tooling tests hold it to lint, the structure check and the tests. `make test` fails likewise until the first runtime task puts its tests there.
- **Agent tooling.** `make agent-check`, the structure check plus the tests of the agent tooling itself, is no stage of a task. `gate` runs it first when the branch changes that tooling; the hosted check `Agent structure` runs it, and the documentation check, on the pull request; run it by hand after a scaffold update.
- **The end of the queue.** `finish` refuses the task that completes the queue unless a `pr-check` and a `premerge-check`, passed or not applicable, cover its commit, and while the base branch has commits its branch lacks: the local one, or `origin`'s as last fetched. What the slow suites find is fixed as a task of its own. The price is known and accepted: a task can break what only a slow test shows, and the acceptance task is where that surfaces.
- **Durations.** A gate prints the duration of every stage, also after a failure, and the helper says when it ran over its budget in the manifest: tell the owner; a slow stage of the task gate belongs in `MILESTONE_STAGES`.

## A parallel round

`READY` tasks that touch different files are delivered side by side, by one session that runs the round. The Makefile is such a file: a task that adds a stage or a target to it names `Makefile` among its plan's Affected Components, and a round takes one such task at most.

1. **Claim** the round in one command, `node scripts/agent-local.mjs claim <ID> <ID>...`, so that every branch starts from the same revision of the integration branch. With GitHub issues the helper refuses a task that has no issue yet in a claim of several: that task is claimed and delivered on its own ([Add a task during delivery](workflow.md#add-a-task-during-delivery)).
2. **Place** each task in a worktree of its own: `git worktree add ../<project>.worktrees/<id> task/<id>`.
3. **Deliver** each task there by [Deliver one task](workflow.md#deliver-one-task) up to step 5: its completed plan committed on its branch.
4. **Integrate** from the session's own checkout, on a clean tree: `node scripts/agent-local.mjs integrate <ID> <ID>...`. All or nothing: it makes the checks of `finish` for every task, merges the branches without touching a worktree, runs one combined task gate on the assembled commit when more than one task changed runtime files, then advances the integration branch in one atomic step and updates GitHub once. The combined gate checks the assembled commit out in that checkout and returns the checkout to where it was.
5. **Report** every task as step 7 of [Deliver one task](workflow.md#deliver-one-task) says and remove the worktrees: `git worktree remove ../<project>.worktrees/<id>`, never with `--force`. A worktree Git refuses to remove holds uncommitted or untracked work: leave it and tell the owner.

A round that cannot be integrated moves nothing and says why; its tasks are then integrated serially, each with `finish` from its own branch. After a conflict, which names the task and the files, integrate the other tasks, then merge the integration branch into the conflicting one, gate and `finish` it. After a failed combined gate, finish the tasks one at a time to find the one that breaks the others.

A round never completes the queue: the last task is delivered on its own, through `finish` and the full gates. A project whose task gate needs something shared, such as a fixed port or one database, is delivered serially.

## GitHub mirror

A manifest that names a `repository` has a mirror of this state on GitHub; one without is delivered without GitHub, and the rest of this section does not apply. `"issues": false` in the manifest narrows the mirror to the integration branch: it is pushed as below, and no issue is created, labelled or closed; "with issues" below means a manifest without that line. Turn issues on between milestones, then run `publish`, and commit the issue numbers it writes on the base branch. The repository stays the source of truth: change the plan, never the issue.

- **Integration branch:** `claim`, `finish` and `integrate` push it, so GitHub holds every finished task; the push is skipped only when `origin`'s branch, as last fetched, already equals the local tip. A push of this branch starts no hosted check.
- **Base branch:** planning pushes it with documents only. A hosted workflow that runs on a push to the base branch ignores `docs/**` and `scripts/agent-*` in its `paths-ignore`, so that it builds and publishes when product code arrives, at the milestone's merge, and not for a plan.
- **Issues**, unless turned off: one per task, in the GitHub milestone `Milestone <N>`, its body generated from the plan. Each carries one status label, the state `next` shows: `waiting`, `blocked`, `ready`, `in-progress`, `done`. An issue closes when its task is on the integration branch. Task identifiers are not issue numbers.

[`scripts/agent-issues.mjs`](../../scripts/agent-issues.mjs) keeps the mirror, changing only what differs. `claim`, `finish` and `integrate` update, once per command, only the issues they affect, those of the tasks they name and of the tasks that depend on them directly: the state, the status label, the body and the title. An issue that is in no GitHub milestone yet, one the owner wrote and a feature adopted, makes that update a full one. `node scripts/agent-local.mjs publish` reconciles everything: the labels, the GitHub milestone and every issue. `node scripts/agent-issues.mjs sync --check` changes nothing and fails on any difference. A task that has no issue yet gets one at its claim: [Add a task during delivery](workflow.md#add-a-task-during-delivery).

When GitHub cannot be reached, or `--no-publish` deferred the update, the local result stands and a marker in the Git directory records it: `next` reports that GitHub is out of sync until `publish` succeeds.

## Timings

The helper logs every claim, gate, integration and publication with its duration in the Git directory: local, never pushed, and no step measures itself. `node scripts/agent-local.mjs timings` prints where the time went: per task from claim to integration, then the combined, the full and the resilience gates with their stages, and GitHub publication. Print it after a round or a finished queue.
