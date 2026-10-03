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

The project's `docs/agents/workflow.md` is the contract for delivering a task: read it now. `docs/agents/acceptance.md` holds the acceptance task, a standalone feature's acceptance and the pull request: read it when the run reaches one of them, and only then. `AGENTS.md` reaches you through `CLAUDE.md`; `docs/agents/planning.md` is no part of delivery. This skill adds what a Claude session needs on top: what the owner hears, whom to dispatch, how to run a round. A project without `docs/agents/workflow.md` is planned first: tell the owner to run `/kordal-plan`.

## Updates

The owner hears of a task at its three phase boundaries:

1. **Started**: `CAP-003 · started · <title>`.
2. **Implemented and gated**, once the review is recorded: the commit, the gate's result and duration, and the review's findings with what was done about each. `CAP-003 · task-check passed on 1a2b3c4 in 48 s · review: 2 findings, 1 fixed, 1 rejected`.
3. **Integrated**: the report of the workflow's step 7.

Each part of the acceptance task, the first look and a blocker get an update of their own. A mechanical operation (a branch switched, a plan moved, a merge, a worktree added or removed) gets none.

## Deliver one task

The procedure is "Deliver one task" of `docs/agents/workflow.md`: its seven steps in order, each to its "Done when". On top of it:

- **Which task.** With no ID: a `CLAIMED` task whose branch no other worktree has checked out (`git worktree list`), resumed on its branch; else the first `READY` one of `node scripts/agent-local.mjs next`.
- **Step 4.** The reviewer is [the review](#the-review).
- **Step 6.** Where `finish` warns that GitHub was not updated, run `node scripts/agent-local.mjs publish` before the report.
- **The task that completes the queue** continues in [The acceptance task](#the-acceptance-task) or [A standalone feature](#a-standalone-feature).

## The review

A reviewer with a context of its own, which has not seen the implementation, and which only reads.

- **A task** gets one pass: dispatch the `kordal-task-reviewer` agent once, in the foreground (both axes in one report).
- **The milestone review**, and the review of a whole standalone feature, get two: dispatch the `kordal-reviewer` agent twice in one message, "Axis: Standards" and "Axis: Spec".

Give each dispatch:

- the repository path;
- the exact diff command: `git diff <integration branch>...HEAD` for a task, `git diff <base branch>...HEAD` for a milestone or a feature;
- what to judge against: `AGENTS.md` and the ADRs for Standards; the plan's path, or `docs/product/milestone<N>.md` for a milestone review, for Spec;
- the high-risk areas of the diff: the changed files that touch authentication, authorization or permissions, persistence or migrations, a security boundary or a public API, or "none". The reviewer reads those whole and traces their callers, and the rest in proportion to the change.

Keep Standards and Spec apart, as the reviewer returned them, and act on a finding once you have checked it against the code.

Where the reviewing agent is missing or its dispatch fails, run the `code-review` skill on the same diff instead and record in the Review section that the session's own model reviewed.

## Work the queue

Open with the plan of the run, before the first task, in one short message:

- **Tasks**, in the order they will be delivered: ID and title of every unfinished task from `next`, the acceptance task last, and which of them can run in parallel. Mark a `BLOCKED` task with its blocker: the run stops before it.
- **Models**: delivery, `kordal-builder`; task review, `kordal-task-reviewer`; milestone review, `kordal-reviewer`; the acceptance task and this session. Name the model each runs on: the one its agent definition sets, else this session's. Where an agent is missing, say that a generic subagent takes its place.
- **Where it stops**: at the owner's test in the acceptance task, and at the conditions under "Stop and ask".

Then deliver the queue in rounds, until `next` lists no `READY` task and none this checkout left `CLAIMED`. A `kordal-builder` agent delivers each task. Its steps stay inside its own context, so the line that opens a round and the reports that close it are the owner's [updates](#updates).

1. **Pick the round**: the `READY` tasks, up to five, whose plans' Affected Components do not overlap. Tasks that touch the same files go into separate rounds, in manifest order. The task that owes the owner a [first look](#stop-and-ask) is a round of its own. `all serial` picks one task per round. Tasks an interrupted run left `CLAIMED` come first: each is resumed where its branch is checked out.
2. **Open it** with one line to the owner: `Round 2 · CAP-003, CAP-005 in parallel · 4 of 6 tasks left`.
3. **A round of one task** is delivered serially, in this checkout: dispatch its builder in the foreground, "Deliver task `<ID>` in `<project root>` on your own: claim it, deliver it and `finish` it." Done when `next` no longer lists the task; continue at step 8.
4. **Claim** a round of several tasks in one command, `node scripts/agent-local.mjs claim <ID> <ID>...`, so that every branch starts from the same revision and GitHub is updated once. Give each task a worktree next to the project: `git worktree add ../<project>.worktrees/<id> task/<id>`.
5. **Dispatch** one builder per task, all in one message so that they run side by side, each in the foreground: "Deliver task `<ID>` in `<its worktree>` as one task of a round. It is already claimed there, on `task/<id>`. Stop once its completed plan is committed, without `finish`, and report 'ready for integration' with the commit, the gate's result and the report."
6. **Verify** each result yourself, in its worktree: `git status --porcelain` prints nothing; the completed plan is committed (`git cat-file -e HEAD:docs/plans/completed/<ID>-<slug>.md`); and, for a task that changed a runtime file, `node scripts/agent-local.mjs gate` answers `reused`: the builder's gate covers the commit. A task its builder left short of that is yours to complete there, by "Deliver one task" up to step 5.
7. **Integrate** the round in one command, from this checkout, on a clean tree: `node scripts/agent-local.mjs integrate <ID> <ID>...`. It moves every task or none; read the files a `NOTE` names as changed by more than one task. Where it refuses, tell the owner why and fall back to serial `finish`, each task from its worktree, as "A parallel round" of the workflow says: after a conflict, integrate the other tasks first, then merge, gate and `finish` the conflicting one; after a failed combined gate, `finish` them one at a time. Where a command warns that GitHub was not updated, run `node scripts/agent-local.mjs publish`.
8. **Report.** Post the report of each task the round integrated on its issue, as the workflow's step 7 says; a builder that finished on its own has posted its own. Remove the worktrees you added for the round, `git worktree remove ../<project>.worktrees/<id>`, never forced: one that refuses holds uncommitted work, so leave it and tell the owner. Relay the reports in task order with the output of `node scripts/agent-local.mjs timings`, and start the next round without waiting for an answer, except after a first look.

Where the `kordal-builder` agent is missing, a generic subagent takes the same prompt, with this added: its procedure is "Deliver one task" of `docs/agents/workflow.md`, the reviewer of step 4 is a subagent that only reads, and it stops and reports at the conditions under "Stop and ask", which you list for it.

The first look is yours to hold: when its builder returns, start the product on every device the milestone targets, tell the owner how to reach it, and wait for the answer, which the workflow's "First look" says how to record.

The task gate starts nothing, so it runs in several worktrees at once. A project whose task gate still needs a fixed port or one shared database is delivered with `all serial`; when the gates of a first parallel round collide, `finish` that round's tasks one at a time, continue with one task per round and tell the owner.

The task that completes the queue is yours, never a subagent's and never part of a round, because it stops for the owner: the milestone's acceptance task goes by [The acceptance task](#the-acceptance-task), the last task of a standalone feature by [A standalone feature](#a-standalone-feature). When only `WAIT` and `BLOCKED` tasks remain, report each blocker with who resolves it and stop.

## The acceptance task

Read `docs/agents/acceptance.md` and follow its "The acceptance task" on the task's own branch, with an update to the owner as each of its four parts closes. On top of it:

- **Full check.** Walk the Flows with the browser tool of this session or the project's own tooling.
- **Milestone review.** Run [the review](#the-review), two reviewers, on the diff since the base branch. Deliver each fix task by [Deliver one task](#deliver-one-task).
- **Owner acceptance.** Leave the product running, give the owner the checklist and how to reach the product, and stop. The owner's test is a gate: the milestone waits there until the owner answers.
- **Gates.** Run `gate pr-check` and `gate premerge-check` where that document names them, and leave the decision to them: each runs when a runtime file changed since it passed and answers `reused` when none did, and `finish` refuses a state they do not cover.
- **Finish.** Tell the owner `/kordal-build-ship` is next.

## A standalone feature

A feature on its own `feature/<slug>` branch has no acceptance task: its last task carries the acceptance. Deliver that task by "Deliver one task" up to its review, then follow "A standalone feature" of `docs/agents/acceptance.md` before `finish`, with the additions of [The acceptance task](#the-acceptance-task).

## Ship

Ship only when the owner typed `/kordal-build-ship` or `/kordal-build ship`: the pull request to the base branch (`node scripts/agent-local.mjs base`) is the release of the milestone or the feature, so it is opened on the owner's explicit command and in no other mode.

1. Confirm the gate before the pull request: `next` lists nothing, and the test document on the integration branch records the owner's acceptance: `docs/product/milestone<N>-test.md`, with the milestone review, or `docs/product/feature-<slug>-test.md`. Where one is missing, say which and stop.
2. Follow "Open the pull request" of `docs/agents/acceptance.md`.
3. Shut down what the milestone started on this machine: the test servers, emulators and simulators, app test builds, containers and background processes of this project's checkouts, and the worktrees under `../<project>.worktrees/`. Stop only what this project's delivery started; the owner's installed apps, other projects' stacks and anything you cannot attribute stay untouched, and are listed instead. Stop containers, do not remove their data. A worktree that holds uncommitted work stays, and is listed.
4. Report the pull request's URL and the state of its checks, what was shut down and what was left running, and stop: the owner merges.

## Stop and ask

Keep the queue moving; the owner reads the updates as they arrive and interrupts when something looks wrong. Stop and ask only for:

- a change to the agreed scope or to a task's contract;
- a fact or decision only the owner has;
- an external blocker;
- a gate that failed three times on the same cause: report the cause and what you tried;
- the workflow's "First look": the first task that changes what a user sees;
- a step that will run longer than the milestone's test budget allows, or a gate that reports it took longer than its budget.
