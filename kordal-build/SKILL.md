---
name: kordal-build
description: Deliver the planned MVP through the project's delivery workflow - the next ready task, a named task, the whole queue, or the final push.
disable-model-invocation: true
argument-hint: "[task ID | all | ship]"
---

Deliver the tasks `/kordal-plan` prepared. `$ARGUMENTS` picks the mode:

| `$ARGUMENTS` | Mode |
| --- | --- |
| empty | [Deliver one task](#deliver-one-task): the claimed task this checkout left unfinished, else the first `READY` one |
| a task ID | [Deliver one task](#deliver-one-task): that one |
| `all` | [Work the queue](#work-the-queue) |
| `ship` | [Ship](#ship) |

The project's `docs/agents/workflow.md` is the single source of truth for claiming, gates, evidence, the status update, owner acceptance and the push. Read it in full now, with `AGENTS.md` and `docs/agents/claude.md`. This skill adds only how to run it in a Claude session. A project without that file is planned first: tell the owner to run `/kordal-plan`.

## Deliver one task

1. **Place.** Run `node scripts/agent-local.mjs next`. A `CLAIMED` task whose branch no other worktree has checked out (`git worktree list`) is resumed on its branch; otherwise claim the task and switch to `task/<id>`. Move the plan to `active/`.
2. **Implement** the plan: its ADRs first, then every acceptance criterion including the failure behaviour, with the tests the plan names. Commit.
3. **Gate.** `node scripts/agent-local.mjs gate`. Done when it records a pass for the commit.
4. **Review.** Run the `code-review` skill on the diff since the integration branch, on both axes: Standards and Spec. Fix every confirmed finding; a runtime fix returns to step 3.
5. **Evidence.** Start the product on the gated commit and take the screenshots the workflow requires, with the browser tool of this session or the project's own browser tests. Look at each screenshot before recording it: it shows the feature working, with real data. Fill the plan's Evidence and Completion Notes, tick each acceptance criterion you checked against evidence, move the plan to `completed/`, commit.
6. **Finish.** `node scripts/agent-local.mjs finish <ID>`. Done when it prints that the task is on the integration branch.
7. **Report.** Give the owner the status update of the workflow's "Report" section. Show the screenshots themselves: send the files where the session can, link their paths otherwise.

## Work the queue

Repeat until `next` lists no `READY` task and none this checkout left `CLAIMED`:

1. Take the first task in manifest order.
2. Dispatch one foreground subagent for it, so every task starts from its plan with a clean context: "Read `${CLAUDE_SKILL_DIR}/SKILL.md` and deliver task `<ID>` by its section 'Deliver one task', in `<project root>`. End with the verbatim output of `finish`, the status update and the screenshot paths."
3. Verify the result yourself: `next` no longer lists the task, and the screenshot files exist. A task the subagent left unfinished is yours to resume by "Deliver one task".
4. Relay the status update and the screenshots to the owner, and continue with the next task without waiting for an answer.

When the queue is empty, run [Owner acceptance](#owner-acceptance). When only `WAIT` and `BLOCKED` tasks remain, report each blocker with who resolves it and stop.

## Owner acceptance

Follow the workflow's "Owner acceptance" section: write `docs/product/mvp<N>-test.md`, start the product, give the owner the checklist and how to reach the running product, and stop. The owner's test is a gate; the MVP waits there until the owner answers.

Deliver every failure the owner reports as a task, then hand the updated checklist back. When the owner says the MVP passes, record it in the test document and tell them `/kordal-build ship` is next.

## Ship

Ship only on `/kordal-build ship`: the push is public, so it happens on the owner's explicit command and in no other mode.

1. Confirm the gate before the push: `next` lists nothing, and `docs/product/mvp<N>-test.md` records the owner's acceptance of the current head of the integration branch. Commits after the accepted one go back to the owner first.
2. Follow the workflow's "Push when the MVP is done" section.
3. Report the pull request's URL and the state of its checks.

## Stop and ask

Keep the queue moving; the owner reads the status updates as they arrive and interrupts when something looks wrong. Stop and ask only for:

- a change to the agreed scope or to a task's contract;
- a fact or decision only the owner has;
- an external blocker;
- a gate that failed three times on the same cause: report the cause and what you tried.
