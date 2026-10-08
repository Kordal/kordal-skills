# Task delivery workflow

The contract for delivering one planned task, whoever delivers it, and all a builder reads. The session that runs the queue also reads [orchestration.md](orchestration.md): the gates in full, parallel rounds, the GitHub mirror and timings. Planning is [planning.md](planning.md). The milestone's acceptance task also follows [acceptance.md](acceptance.md), which holds the pull request too.

Delivery is **local**: develop, verify and integrate on the local machine. A task needs no pull request and no person's approval: its gate and a review in proportion to its risk stand between it and the integration branch.

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
- **Integration branch**, named by `integration_branch` in the manifest: `milestone<N>`. Finished tasks accumulate here. It starts from the base branch and becomes the milestone's pull request. Nobody commits to it directly and no worktree checks it out. A clone that lacks it takes it from `origin`: `node scripts/agent-local.mjs start`.
- **Done:** the task's completed plan is on the integration branch.
- **Claimed:** the branch `task/<id>` exists (`task/cap-001`).

## Deliver one task

One task per branch. A task delivers its backend, contracts, UI and tests together where applicable; split oversized work into explicitly mapped tasks before starting.

1. **Claim.** `node scripts/agent-local.mjs next` lists every unfinished task as `READY`, `CLAIMED`, `WAIT` (a dependency is not integrated) or `BLOCKED` (its `external_blocker`). `node scripts/agent-local.mjs claim <ID>` creates `task/<id>` from the integration branch; Git refuses a second claim. Switch your worktree to that branch; a task already claimed for you is resumed there. Read the plan, its ADRs, relevant contracts, the Notes of its dependencies and the nested `AGENTS.md` of the directories it changes. Move the plan from `planned/` to `active/`. Done when the worktree is on `task/<id>` and the plan is in `active/`.
2. **Implement** the plan: its ADRs first, then every acceptance criterion and failure behaviour, each with the test that proves it.
   - **Decisions.** Resolve Proposed ADRs the task needs and mark them Accepted in the task. Record alternatives and consequences; explicitly supersede affected portions of older decisions. Routine in-scope design choices are yours. Ask only for missing user-owned facts or scope changes, and keep independent work moving. Change the manifest and the plan together if the task's title, dependencies or ADRs change.
   - **Tests.** Run only what needs nothing started: `make lint` and `make test`. Write the slower tests a criterion needs (browser, device, end-to-end, measurement) where a stage of `MILESTONE_STAGES` picks them up; only a task that brings a new kind of check adds a [stage](orchestration.md#gates). They run once, in the acceptance task. A task starts no product, emulator or app build to check itself; the [first look](#first-look) is the one exception. UI rendering alone does not prove persistence, and unit tests alone do not prove cross-component behaviour: that proof is the acceptance task's.
   - **Budget.** Stay inside the milestone's test budget: the data size and the gate times its scope names. A single step that will run longer than the full gate's budget, such as a load, a measurement or a build, is a reason to stop and ask before it starts.
   - **Environment.** Give each worktree its own isolated environment (ports, data, a git-ignored `.env`), because other worktrees run their own. Real-source credentials stay outside Git and logs. Record failures and environmental blockers accurately.

   Done when every criterion and failure behaviour has its code and tests, your own reading of the diff as a reviewer (contracts, migrations, failure paths, permissions, cross-component behaviour) leaves nothing open, and the work is committed.
3. **Gate.** `node scripts/agent-local.mjs gate` runs the [task gate](orchestration.md#gates): lint, the structure check and the fast tests. It runs nothing and says `reused` when no runtime file changed since it last passed. A documentation task needs no gate. Done when it prints that `task-check` passed on the commit.
4. **Review**, in proportion to the risk. An independent review is due when the diff against the integration branch touches authentication, authorization or permissions, persistence or migrations, a security boundary or a public API; when it accepts an ADR; or when it changes more than 300 lines (`git diff --shortstat <integration branch>...HEAD`). Then a reviewer with a fresh context, one that did not write the change and only reads, reviews it on two axes. **Standards:** does the change follow `AGENTS.md`, the ADRs and the conventions of the code around it? **Spec:** does it deliver the plan's acceptance criteria and failure behaviour, and nothing outside its scope? Check each finding against the code: fix what you confirm, and record what you reject with the reason. A runtime fix returns to step 3. Any other diff gets your own second reading on both axes instead, recorded as `Self-reviewed: low risk`, with the reason: no high-risk area, how many lines. The milestone review in the acceptance task reads every task's change again. Done when the plan's Review section records the reviewed commit, who reviewed (the agent and its model, or the self-review line), and each finding with what was done about it, or "No findings".
5. **Complete.** Tick each acceptance criterion the code and its tests deliver, fill the Notes with what changed, deviations and follow-up work, move the plan to `completed/` and commit. Commits after the gate may change documentation only, which keeps its result; a runtime change returns to step 3. Done when the completed plan is committed and `make structure-check` passes: it rejects a pending Review, an unticked criterion and an ADR that is not Accepted.
6. **Integrate.** `node scripts/agent-local.mjs finish <ID>`, from the task's branch. It refuses a dirty or foreign branch, a missing or unreviewed completed plan, a second task's plan in the same branch, a runtime change that no passed gate covers, and documentation that fails its check ([Gates](orchestration.md#gates), Reuse). If the integration branch moved meanwhile, merge it into your branch and gate again. Then it fast-forwards the integration branch to your commit and updates the GitHub mirror. A task of [a parallel round](orchestration.md#a-parallel-round) stops after step 5: the round integrates it. Done when `finish` prints that the task is on the integration branch.
7. **Report.** Give the owner a status update, then select the next task if you were asked to process the queue:
   - **Added:** what a user can now do, in plain words.
   - **Verified:** the unit tests that cover the change and the gate result with its commit; and which slower tests the task wrote for the end of the milestone.
   - **Try it:** the two or three steps by which the owner sees it working.
   - **Next:** the output of `node scripts/agent-local.mjs next`, and any follow-up recorded in the plan's Notes.

   With GitHub issues, post the same update on the task's issue: write it to a file outside the repository and run `node scripts/agent-issues.mjs comment <ID> <file>`. Done when the owner has the update and the issue carries it.

## Add a task during delivery

A task found during delivery (a review finding, a failure the owner reports, a split of oversized work) is added in the checkout that will deliver it: write its plan from the [template](../plans/template.md), add it to the manifest, and `claim` it, on its own. With GitHub issues that claim creates its issue and writes the number into the manifest and the plan of this checkout; in a claim of several tasks the helper refuses a task without an issue, whose number no task's branch would hold. Switch to its branch and commit the plan and the manifest, the issue number in both, there with the work.

## First look

The first task of a milestone that changes what a user sees is delivered on its own, outside a parallel round, and ends with a stop. After its status update, leave the product running on every device the milestone targets, tell the owner how to reach it, and wait: the owner looks at the real thing before the rest is built on it. Record the owner's answer under "First look" in `docs/product/milestone<N>.md`, with the task and the date. A change the owner asks for is a change of scope: plan it before the queue continues.
