---
name: kordal-build
description: Deliver the planned milestone through the project's delivery workflow - the next ready task, a named task, the whole queue, or the final push.
disable-model-invocation: true
model: claude-opus-5-5
effort: medium
argument-hint: "[task ID | all | ship]"
---

Deliver the tasks `/kordal-plan` prepared. `$ARGUMENTS` picks the mode:

| `$ARGUMENTS` | Mode |
| --- | --- |
| empty | [Deliver one task](#deliver-one-task): the claimed task this checkout left unfinished, else the first `READY` one |
| a task ID | [Deliver one task](#deliver-one-task): that one |
| `all` | [Work the queue](#work-the-queue) |
| `ship` | [Ship](#ship): open the pull request of the milestone or the feature |

The project's `docs/agents/workflow.md` is the single source of truth for claiming, gates, the review, the status update, the acceptance task and the pull request. Read it in full now, with `AGENTS.md` and `docs/agents/claude.md`. This skill adds only how to run it in a Claude session. A project without that file is planned first: tell the owner to run `/kordal-plan`.

Delivery runs on Opus 5.5 at medium effort: the frontmatter pins it for the turn that invokes the skill, the `kordal-builder` agent for every task of the queue. The review runs at high effort in the `kordal-reviewer` agent.

## Announce every step

Before starting a step of "Deliver one task", tell the owner in one line which task and which step begins: `CAP-003 · step 3 of 7 · Gate`. Add what the step just before it produced when that is one fact: the commit, the gate's duration, the number of review findings. The acceptance task and the pull request announce their parts the same way.

## Deliver one task

1. **Place.** Run `node scripts/agent-local.mjs next`. A `CLAIMED` task whose branch no other worktree has checked out (`git worktree list`) is resumed on its branch; otherwise claim the task and switch to `task/<id>`. Move the plan to `active/`.
2. **Implement** the plan: its ADRs first, then every acceptance criterion including the failure behaviour, with the tests the plan names. Commit.
3. **Gate.** `node scripts/agent-local.mjs gate`. Done when it records a pass for the commit.
4. **Review.** Run [the review](#the-review) on the diff since the integration branch, against the task's plan. Fix every confirmed finding; a runtime fix returns to step 3. Done when the plan's Review section records the reviewed commit, the reviewer and each finding with its resolution.
5. **Check.** Start the product on the gated commit and walk the plan's Flow as a user would, with the browser tool of this session or the project's own browser tests: the journey and each failure path. Fix what you find; a runtime fix returns to step 3. Then tick each acceptance criterion you saw work, fill the Completion Notes, move the plan to `completed/`, commit.
6. **Finish.** `node scripts/agent-local.mjs finish <ID>`. Done when it prints that the task is on the integration branch and, with a GitHub mirror, that the branch was pushed and the issues synced. A warning that GitHub was not updated is repaired with `node scripts/agent-local.mjs publish` before the report.
7. **Report.** Give the owner the status update of the workflow's "Report" section, and post it on the task's issue as that section says.

## The review

The reviewer is the `kordal-reviewer` agent: Opus 5.5 at high effort, with a context of its own that has not seen the implementation, and it only reads.

Dispatch it twice in one message, once per axis, each in the foreground: "Axis: Standards" and "Axis: Spec". Give each the repository path, the exact diff command (`git diff <base>...HEAD`), and what to judge against: `AGENTS.md` and the task's ADRs for Standards; the plan's path, or `docs/product/milestone<N>.md` for a milestone review, for Spec.

Keep the two reports apart, as the reviewer returned them. Check each finding against the code before acting on it: fix what you confirm, and record what you reject with the reason.

Where the `kordal-reviewer` agent is missing or its dispatch fails, run the `code-review` skill on the same diff instead and record in the Review section that the session's own model reviewed.

## Work the queue

Open with the plan of the run, before the first task, in one short message:

- **Tasks**, in the order they will be delivered: ID and title of every unfinished task from `next`, the acceptance task last. Mark a `BLOCKED` task with its blocker: the run stops before it.
- **Models**: delivery, `kordal-builder`; review, `kordal-reviewer`; the acceptance task and this session. Read each agent's model and effort from its definition in `~/.claude/agents/` and name this session's own model; where an agent is missing, say that a generic subagent on the session's model takes its place.
- **Where it stops**: at the owner's test in the acceptance task, and at the conditions under "Stop and ask".

Then repeat until `next` lists no `READY` task and none this checkout left `CLAIMED`:

1. Take the first task in manifest order.
2. Announce the task to the owner: `CAP-003 · started · 3 of 6 tasks`. The subagent's steps stay inside its own context, so this line and the status update at the end are what the owner sees of a task in this mode.
3. Dispatch one foreground `kordal-builder` agent for it (Opus 5.5 at medium effort; a generic subagent where that agent is missing), so every task starts from its plan with a clean context: "Read `${CLAUDE_SKILL_DIR}/SKILL.md` and deliver task `<ID>` by its section 'Deliver one task', in `<project root>`. End with the verbatim output of `finish` and the status update."
4. Verify the result yourself: `next` no longer lists the task. A task the subagent left unfinished is yours to resume by "Deliver one task".
5. Relay the status update to the owner, and continue with the next task without waiting for an answer.

The milestone's acceptance task is yours, not a subagent's: when it is the task to take, deliver it by [The acceptance task](#the-acceptance-task). So is the last task of [a standalone feature](#a-standalone-feature). When only `WAIT` and `BLOCKED` tasks remain, report each blocker with who resolves it and stop.

## The acceptance task

Follow the workflow's "The acceptance task" section on the task's own branch:

1. **Milestone review.** Run [the review](#the-review) on the diff since main. Add each confirmed finding as a task, deliver it by "Deliver one task", merge the integration branch and review again. Done when the review of the current head has no open finding and `docs/product/milestone<N>-test.md` records it.
2. **Owner acceptance.** Complete the test document, start the product, give the owner the checklist and how to reach the running product, and stop. The owner's test is a gate; the milestone waits there until the owner answers. Deliver every failure the owner reports as a task, then hand the updated checklist back.
3. **Finish.** When the owner says the milestone passes, record it in the test document, run both gates, finish the task and tell the owner `/kordal-build ship` is next.

## A standalone feature

A feature on its own `feature/<slug>` branch has no acceptance task. Its last task carries the acceptance: deliver it by "Deliver one task" up to the check, then follow the workflow's "A standalone feature" section before `finish`. Take that task yourself, as you take an acceptance task, because it stops for the owner.

## Ship

Ship only on `/kordal-build ship`: the pull request to main is the milestone's release, so it is opened on the owner's explicit command and in no other mode.

1. Confirm the gate before the pull request: `next` lists nothing, and the test document on the integration branch records the owner's acceptance: `docs/product/milestone<N>-test.md`, with the milestone review, or `docs/product/feature-<slug>-test.md`.
2. Follow the workflow's "Open the pull request when the work is done" section.
3. Report the pull request's URL and the state of its checks, and stop: the owner merges.

## Stop and ask

Keep the queue moving; the owner reads the status updates as they arrive and interrupts when something looks wrong. Stop and ask only for:

- a change to the agreed scope or to a task's contract;
- a fact or decision only the owner has;
- an external blocker;
- a gate that failed three times on the same cause: report the cause and what you tried.
