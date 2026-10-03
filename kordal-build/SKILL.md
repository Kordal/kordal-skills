---
name: kordal-build
description: Deliver the planned milestone through the project's delivery workflow - the next ready task, a named task, the whole queue, or the final push.
disable-model-invocation: false
argument-hint: "[task ID | all | all serial | ship]"
---

Deliver the tasks `/kordal-plan` prepared. `$ARGUMENTS` picks the mode:

| `$ARGUMENTS` | Mode |
| --- | --- |
| empty | [Deliver one task](#deliver-one-task): the claimed task this checkout left unfinished, else the first `READY` one |
| a task ID | [Deliver one task](#deliver-one-task): that one |
| `all` | [Work the queue](#work-the-queue), independent tasks in parallel |
| `all serial` | [Work the queue](#work-the-queue), one task at a time |
| `ship` | [Ship](#ship): open the pull request of the milestone or the feature |

The project's `docs/agents/workflow.md` is the single source of truth for claiming, gates, the review, the status update, the acceptance task and the pull request. Read it in full now, with `AGENTS.md` and `docs/agents/claude.md`. This skill adds only how to run it in a Claude session. A project without that file is planned first: tell the owner to run `/kordal-plan`.

## Announce every step

Before starting a step of "Deliver one task", tell the owner in one line which task and which step begins: `CAP-003 · step 3 of 7 · Gate`. Add what the step just before it produced when that is one fact: the commit, the gate's duration, the number of review findings. The acceptance task and the pull request announce their parts the same way.

## Deliver one task

1. **Place.** Run `node scripts/agent-local.mjs next`. A task your prompt says is claimed in your checkout, or a `CLAIMED` task whose branch no other worktree has checked out (`git worktree list`), is resumed on its branch; otherwise claim the task and switch to `task/<id>`. Move the plan to `active/`.
2. **Implement** the plan: its ADRs first, then every acceptance criterion including the failure behaviour, with the tests the plan names. Commit.
3. **Gate.** `node scripts/agent-local.mjs gate`. Done when it records a pass for the commit.
4. **Review.** Run [the review](#the-review) on the diff since the integration branch, against the task's plan. Fix every confirmed finding; a runtime fix returns to step 3. Done when the plan's Review section records the reviewed commit, the reviewer and each finding with its resolution.
5. **Complete the plan.** A task runs lint and unit tests and nothing slower: no product, emulator or app build is started to check it, and the slower tests it wrote wait for the acceptance task. Tick each acceptance criterion the code and its tests deliver, fill the Completion Notes, move the plan to `completed/`, commit.
6. **Finish.** `node scripts/agent-local.mjs finish <ID>`. Done when it prints that the task is on the integration branch and, with a GitHub mirror, that the branch was pushed and the issues synced. A warning that GitHub was not updated is repaired with `node scripts/agent-local.mjs publish` before the report.
7. **Report.** Give the owner the status update of the workflow's "Report" section, and post it on the task's issue as that section says.

## The review

A reviewer with a context of its own, which has not seen the implementation, and which only reads.

- **A task** gets one pass: dispatch the `kordal-task-reviewer` agent once, in the foreground (both axes in one report).
- **The milestone review**, and the review of a whole standalone feature, get two: dispatch the `kordal-reviewer` agent twice in one message, "Axis: Standards" and "Axis: Spec".

Give each dispatch the repository path, the exact diff command (`git diff <base>...HEAD`), and what to judge against: `AGENTS.md` and the ADRs for Standards; the plan's path, or `docs/product/milestone<N>.md` for a milestone review, for Spec.

Keep Standards and Spec apart, as the reviewer returned them. Check each finding against the code before acting on it: fix what you confirm, and record what you reject with the reason.

Where the reviewing agent is missing or its dispatch fails, run the `code-review` skill on the same diff instead and record in the Review section that the session's own model reviewed.

## Work the queue

Open with the plan of the run, before the first task, in one short message:

- **Tasks**, in the order they will be delivered: ID and title of every unfinished task from `next`, the acceptance task last, and which of them can run in parallel. Mark a `BLOCKED` task with its blocker: the run stops before it.
- **Models**: delivery, `kordal-builder`; task review, `kordal-task-reviewer`; milestone review, `kordal-reviewer`; the acceptance task and this session. Name the model each runs on: the one its agent definition sets, else this session's. Where an agent is missing, say that a generic subagent takes its place.
- **Where it stops**: at the owner's test in the acceptance task, and at the conditions under "Stop and ask".

Then deliver the queue in rounds, until `next` lists no `READY` task and none this checkout left `CLAIMED`:

1. **Pick the round**: the `READY` tasks, up to five, whose plans' Affected Components do not overlap. Tasks that touch the same files go into separate rounds, in manifest order. `all serial` picks one task per round.
2. **Announce it** to the owner: `Round 2 · CAP-003, CAP-005 in parallel · 4 of 6 tasks left`. The agents' steps stay inside their own contexts, so this line and the status updates at the end are what the owner sees of a round.
3. **Prepare** a round of more than one task: `claim` each task here, one after the other, and give each its own checkout next to the project: `git worktree add ../<project>.worktrees/<id> task/<id>`. A round of one task needs neither; its agent claims the task itself in this checkout.
4. **Dispatch** one `kordal-builder` agent per task (a generic subagent where that agent is missing), all in one message so that they run side by side, each in the foreground: "Read `${CLAUDE_SKILL_DIR}/SKILL.md` and deliver task `<ID>` by its section 'Deliver one task', in `<its checkout>`. The task is claimed on its branch there. End with the verbatim output of `finish` and the status update."
5. **Verify** each result yourself: `next` no longer lists the task. A task an agent left unfinished is yours to resume by "Deliver one task" in its checkout. Where `next` reports GitHub out of sync, run `node scripts/agent-local.mjs publish`.
6. **Clean up** the round's checkouts: `git worktree remove ../<project>.worktrees/<id>`.
7. **Relay** the status updates in task order, and start the next round without waiting for an answer, except after the task that owes the owner a [first look](#stop-and-ask): put that task in a round of its own.

Tasks of one round finish one after the other: the second to finish finds the integration branch moved, merges it and gates again, as the workflow says. The task gate starts nothing, so it runs in several checkouts at once. A project whose task gate still needs a fixed port or one shared database is delivered with `all serial`; when the gates of a first parallel round collide, finish that round one task at a time, continue serially and tell the owner.

The milestone's acceptance task is yours, not a subagent's: when it is the task to take, deliver it by [The acceptance task](#the-acceptance-task). So is the last task of [a standalone feature](#a-standalone-feature). When only `WAIT` and `BLOCKED` tasks remain, report each blocker with who resolves it and stop.

## The acceptance task

Follow the workflow's "The acceptance task" section on the task's own branch:

1. **Full check.** Run both full gates (`gate pr-check`, `gate premerge-check`), then start the product and walk every task's Flow on each target device, with the browser tool of this session or the project's own tooling. Deliver each failure as a task and run the failed part again.
2. **Milestone review.** Run [the review](#the-review) on the diff since main. Add each confirmed high or medium finding as a task and deliver it by "Deliver one task"; list the low ones under "Follow-up" in the test document. Then merge the integration branch and review once more, the diff of the fix tasks only. Done when that review has no high or medium finding and `docs/product/milestone<N>-test.md` records both reviews.
3. **Owner acceptance.** Complete the test document, leave the product running, give the owner the checklist and how to reach the running product, and stop. The owner's test is a gate; the milestone waits there until the owner answers. Deliver every failure the owner reports as a task, then hand the updated checklist back.
4. **Finish.** When the owner says the milestone passes, record it in the test document, run the full gates again where a fix task merged since the full check, finish the task and tell the owner `/kordal-build-ship` is next.

## A standalone feature

A feature on its own `feature/<slug>` branch has no acceptance task. Its last task carries the acceptance: deliver it by "Deliver one task" up to the review, then follow the workflow's "A standalone feature" section before `finish`. Take that task yourself, as you take an acceptance task, because it stops for the owner.

## Ship

Ship only on `/kordal-build-ship`: the pull request to main is the milestone's release, so it is opened on the owner's explicit command and in no other mode.

1. Confirm the gate before the pull request: `next` lists nothing, and the test document on the integration branch records the owner's acceptance: `docs/product/milestone<N>-test.md`, with the milestone review, or `docs/product/feature-<slug>-test.md`.
2. Follow the workflow's "Open the pull request when the work is done" section.
3. Shut down what the milestone started on this machine: the test servers, emulators and simulators, app test builds, containers and background processes of this project's checkouts, and the worktrees under `../<project>.worktrees/`. Stop only what this project's delivery started; the owner's installed apps, other projects' stacks and anything you cannot attribute stay untouched, and are listed instead. Stop containers, do not remove their data.
4. Report the pull request's URL and the state of its checks, what was shut down and what was left running, and stop: the owner merges.

## Stop and ask

Keep the queue moving; the owner reads the status updates as they arrive and interrupts when something looks wrong. Stop and ask only for:

- a change to the agreed scope or to a task's contract;
- a fact or decision only the owner has;
- an external blocker;
- a gate that failed three times on the same cause: report the cause and what you tried;
- the workflow's "First look": the first task that changes what a user sees;
- a step that will run longer than the milestone's test budget allows, or a gate that reports it took longer than its budget.
