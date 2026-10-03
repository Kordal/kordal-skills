# Task delivery workflow

The contract for delivering one planned task, whoever delivers it. Planning is [planning.md](planning.md). The task that completes the queue, a milestone's acceptance task or the last task of a standalone feature, also follows [acceptance.md](acceptance.md), which holds the pull request too.

Delivery is **local**: develop, verify and integrate on the local machine. A task needs no pull request and no person's approval: its gate and an independent review stand between it and the integration branch.

## Sources of truth

| Question | Authority |
| --- | --- |
| What product are we building? | The current milestone's scope, `docs/product/milestone<N>.md` for the `milestone` of the manifest, then the selected task's plan |
| Which plan and dependencies belong to a task? | [backlog.json](../plans/backlog.json) |
| Is work available, claimed or done? | The local repository: `node scripts/agent-local.mjs next` |
| Why this architecture? | Applicable ADRs in `docs/adr/` |
| What proves completion? | Plan acceptance criteria, the recorded review and a passed local gate that covers the task's commits |

The local repository holds the state, and every worktree of it sees the same:

- **Base branch:** `node scripts/agent-local.mjs base` prints it: `base_branch` of the manifest, `main` without one.
- **Integration branch**, named by `integration_branch` in the manifest: `milestone<N>`, or `feature/<slug>` for a standalone feature. Finished tasks accumulate here. It starts from the base branch and becomes the milestone's pull request. Nobody commits to it directly and no worktree checks it out. A clone that lacks it takes it from `origin`: `node scripts/agent-local.mjs start`.
- **Done:** the task's completed plan is on the integration branch.
- **Claimed:** the branch `task/<id>` exists (`task/cap-001`).

## Deliver one task

One task per branch. A task delivers its backend, contracts, UI and tests together where applicable; split oversized work into explicitly mapped tasks before starting.

1. **Claim.** `node scripts/agent-local.mjs next` lists every unfinished task as `READY`, `CLAIMED`, `WAIT` (a dependency is not integrated) or `BLOCKED` (its `external_blocker`). `node scripts/agent-local.mjs claim <ID>` creates `task/<id>` from the integration branch; Git refuses a second claim. Switch your worktree to that branch; a task already claimed for you is resumed there. Read the plan, its ADRs, relevant contracts, the completion notes of its dependencies and the nested `AGENTS.md` of the directories it changes. Move the plan from `planned/` to `active/`. Done when the worktree is on `task/<id>` and the plan is in `active/`.
2. **Implement** the plan: its ADRs first, then every acceptance criterion and failure behaviour, with the tests the plan names.
   - **Decisions.** Resolve Proposed ADRs the task needs and mark them Accepted in the task. Record alternatives and consequences; explicitly supersede affected portions of older decisions. Routine in-scope design choices are yours. Ask only for missing user-owned facts or scope changes, and keep independent work moving. Change the manifest and the plan together if the task contract changes.
   - **Tests.** Run only what needs nothing started: `make lint` and `make test`. Write the slower tests the plan names (browser, device, end-to-end, measurement) where a stage of `MILESTONE_STAGES` picks them up; only a task that brings a new kind of check adds a [stage](#gates). They run once, in the acceptance task. A task starts no product, emulator or app build to check itself; the [first look](#first-look) is the one exception. UI rendering alone does not prove persistence, and unit tests alone do not prove cross-component behaviour: that proof is the acceptance task's.
   - **Budget.** Stay inside the milestone's test budget: the data size and the gate times its scope names. A single step that will run longer than the full gate's budget, such as a load, a measurement or a build, is a reason to stop and ask before it starts.
   - **Environment.** Give each worktree its own isolated environment (ports, data, a git-ignored `.env`), because other worktrees run their own. Real-source credentials stay outside Git and logs. Record failures and environmental blockers accurately.

   Done when every criterion and failure behaviour has its code and tests, your own reading of the diff as a reviewer (contracts, migrations, failure paths, permissions, cross-component behaviour) leaves nothing open, and the work is committed.
3. **Gate.** `node scripts/agent-local.mjs gate` runs the [task gate](#gates). A documentation task needs no gate. Done when it prints that `task-check` passed on the commit.
4. **Review.** An independent reviewer with a fresh context, one that did not write the change and only reads, reviews the task's diff against the integration branch on two axes. **Standards:** does the change follow `AGENTS.md`, the ADRs and the conventions of the code around it? **Spec:** does it deliver the plan's acceptance criteria and failure behaviour, and nothing outside its scope? Check each finding against the code: fix what you confirm, and record what you reject with the reason. A runtime fix returns to step 3. Done when the plan's Review section records the reviewed commit, who reviewed (the agent and its model), and each finding with what was done about it, or "No findings".
5. **Complete.** Tick each acceptance criterion the code and its tests deliver, fill the Completion Notes with what changed, deviations and follow-up work, move the plan to `completed/` and commit. Commits after the gate may change documentation only, which keeps its result; a runtime change returns to step 3. Done when the completed plan is committed and `make structure-check` passes: it rejects a pending Review, an unticked criterion and an ADR that is not Accepted.
6. **Integrate.** `node scripts/agent-local.mjs finish <ID>`, from the task's branch. It refuses a dirty or foreign branch, a missing or unreviewed completed plan, a second task's plan in the same branch, a runtime change that no passed gate covers, and documentation that fails its check ([Gates](#gates), Reuse). If the integration branch moved meanwhile, merge it into your branch and gate again. Then it fast-forwards the integration branch to your commit and updates the GitHub mirror. A task of [a parallel round](#a-parallel-round) stops after step 5: the round integrates it. Done when `finish` prints that the task is on the integration branch.
7. **Report.** Give the owner a status update, then select the next task if you were asked to process the queue:
   - **Added:** what a user can now do, in plain words.
   - **Verified:** the unit tests that cover the change and the gate result with its commit; and which slower tests the task wrote for the end of the milestone.
   - **Try it:** the two or three steps by which the owner sees it working.
   - **Next:** the output of `node scripts/agent-local.mjs next`, and any follow-up recorded in Completion Notes.

   With a GitHub mirror, post the same update on the task's issue: write it to a file outside the repository and run `node scripts/agent-issues.mjs comment <ID> <file>`. Done when the owner has the update and the issue carries it.

## Gates

Run a gate through the helper, on a committed, clean tree: `node scripts/agent-local.mjs gate [task-check|pr-check|premerge-check]` records the result for the commit, a failed gate records nothing, and integration checks the record.

| Gate | Stages | When |
| --- | --- | --- |
| `task-check`, the task gate | `TASK_STAGES` of the Makefile: lint, the structure check (`make structure-check`) and the tests that run in a minute or two with nothing started | every task that changes a runtime file, before it is integrated |
| `pr-check`, the full gate | `MILESTONE_STAGES` only: the slow suites, such as a clean bootstrap, acceptance, contracts and browser tests. The helper first makes sure a task gate covers the commit, running it when none does | once, by the task that completes the queue: the acceptance task, or the last task of a standalone feature |
| `premerge-check`, the resilience gate | `RESILIENCE_STAGES`: operations, backup/restore, upgrade, build and verification of the release artifacts | once, with the full gate |

- **Reuse.** A recorded gate covers every later commit until a runtime file changes: `gate` then runs nothing and says `reused` (`--force` runs it anyway). So the Review, the Completion Notes and the owner's test document, committed after a gate, keep its result. Documentation needs no gate and keeps a recorded one, so it is checked where it is integrated: `finish` and `integrate` run the documentation check, `tests/integration/check-docs.sh`, on the commit they integrate, unless a task gate on that very commit ran it, and move nothing while a link is broken. [`scripts/agent-scope.mjs`](../../scripts/agent-scope.mjs) holds which files are runtime, and which are agent tooling.
- **Stages.** A stage is a `.PHONY` make target with a recipe: a gate refuses a stage that make has nothing to run for. A task that adds a kind of check adds its stage: to `TASK_STAGES` when it is fast, to `MILESTONE_STAGES` when it is slow. A gate without stages fails, as the full and the resilience gate of a new repository do; for those two the single word `none` (`RESILIENCE_STAGES := none`) declares the gate not applicable, which passes and is recorded as such. The task gate cannot be `none`: the helper refuses it and records nothing, and the tooling tests hold it to lint, the structure check and the tests. `make test` fails likewise until the first runtime task puts its tests there.
- **Agent tooling.** `make agent-check`, the structure check plus the tests of the agent tooling itself, is no stage of a task. `gate` runs it first when the branch changes that tooling; the hosted check `Agent structure` runs it, and the documentation check, on the pull request; run it by hand after a scaffold update.
- **The end of the queue.** `finish` refuses the task that completes the queue unless a `pr-check` and a `premerge-check`, passed or not applicable, cover its commit, and while the base branch has commits its branch lacks: the local one, or `origin`'s as last fetched. What the slow suites find is fixed as a task of its own. The price is known and accepted: a task can break what only a slow test shows, and the acceptance task is where that surfaces.
- **Durations.** A gate prints the duration of every stage, also after a failure, and the helper says when it ran over its budget in the manifest: tell the owner; a slow stage of the task gate belongs in `MILESTONE_STAGES`.

## A parallel round

`READY` tasks that touch different files are delivered side by side, by one session that runs the round. The Makefile is such a file: a task that adds a stage or a target to it names `Makefile` among its plan's Affected Components, and a round takes one such task at most.

1. **Claim** the round in one command, `node scripts/agent-local.mjs claim <ID> <ID>...`, so that every branch starts from the same revision of the integration branch. With a GitHub mirror the helper refuses a task that has no issue yet in a claim of several: that task is claimed and delivered on its own ([Add a task during delivery](#add-a-task-during-delivery)).
2. **Place** each task in a worktree of its own: `git worktree add ../<project>.worktrees/<id> task/<id>`.
3. **Deliver** each task there by [Deliver one task](#deliver-one-task) up to step 5: its completed plan committed on its branch.
4. **Integrate** from the session's own checkout, on a clean tree: `node scripts/agent-local.mjs integrate <ID> <ID>...`. All or nothing: it makes the checks of `finish` for every task, merges the branches without touching a worktree, runs one combined task gate on the assembled commit when more than one task changed runtime files, then advances the integration branch in one atomic step and updates GitHub once. The combined gate checks the assembled commit out in that checkout and returns the checkout to where it was.
5. **Report** every task as step 7 says and remove the worktrees: `git worktree remove ../<project>.worktrees/<id>`, never with `--force`. A worktree Git refuses to remove holds uncommitted or untracked work: leave it and tell the owner.

A round that cannot be integrated moves nothing and says why; its tasks are then integrated serially, each with `finish` from its own branch. After a conflict, which names the task and the files, integrate the other tasks, then merge the integration branch into the conflicting one, gate and `finish` it. After a failed combined gate, finish the tasks one at a time to find the one that breaks the others.

A round never completes the queue: the last task is delivered on its own, through `finish` and the full gates. A project whose task gate needs something shared, such as a fixed port or one database, is delivered serially.

## Add a task during delivery

A task found during delivery (a review finding, a failure the owner reports, a split of oversized work) is added in the checkout that will deliver it: write its plan from the [template](../plans/template.md), add it to the manifest, and `claim` it, on its own. With a GitHub mirror that claim creates its issue and writes the number into the manifest and the plan of this checkout; in a claim of several tasks the helper refuses a task without an issue, whose number no task's branch would hold. Switch to its branch and commit the plan and the manifest, the issue number in both, there with the work.

## First look

The first task of a milestone that changes what a user sees is delivered on its own, outside a parallel round, and ends with a stop. After its status update, leave the product running on every device the milestone targets, tell the owner how to reach it, and wait: the owner looks at the real thing before the rest is built on it. Record the owner's answer under "First look" in `docs/product/milestone<N>.md`, with the task and the date. A change the owner asks for is a change of scope: plan it before the queue continues.

## GitHub mirror

A manifest that names a `repository` has a mirror of this state on GitHub; one without is delivered without GitHub, and the rest of this section does not apply. The repository stays the source of truth: change the plan, never the issue.

- **Integration branch:** `claim`, `finish` and `integrate` push it, so GitHub holds every finished task; the push is skipped only when `origin`'s branch, as last fetched, already equals the local tip. A push of this branch starts no hosted check.
- **Base branch:** planning pushes it with documents only. A hosted workflow that runs on a push to the base branch ignores `docs/**` and `scripts/agent-*` in its `paths-ignore`, so that it builds and publishes when product code arrives, at the milestone's merge, and not for a plan.
- **Issues:** one per task, in the GitHub milestone `Milestone <N>`, its body generated from the plan. Each carries one status label, the state `next` shows: `waiting`, `blocked`, `ready`, `in-progress`, `done`. An issue closes when its task is on the integration branch. Task identifiers are not issue numbers.

[`scripts/agent-issues.mjs`](../../scripts/agent-issues.mjs) keeps the mirror, changing only what differs. `claim`, `finish` and `integrate` update, once per command, only the issues they affect, those of the tasks they name and of the tasks that depend on them directly: the state, the status label, the body and the title. An issue that is in no GitHub milestone yet, one the owner wrote and a feature adopted, makes that update a full one. `node scripts/agent-local.mjs publish` reconciles everything: the labels, the GitHub milestone and every issue. `node scripts/agent-issues.mjs sync --check` changes nothing and fails on any difference. A task that has no issue yet gets one at its claim: [Add a task during delivery](#add-a-task-during-delivery).

When GitHub cannot be reached, or `--no-publish` deferred the update, the local result stands and a marker in the Git directory records it: `next` reports that GitHub is out of sync until `publish` succeeds.

## Timings

The helper logs every claim, gate, integration and publication with its duration in the Git directory: local, never pushed, and no step measures itself. `node scripts/agent-local.mjs timings` prints where the time went: per task from claim to integration, then the combined, the full and the resilience gates with their stages, and GitHub publication. Print it after a round or a finished queue.
