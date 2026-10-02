# Agent delivery workflow

For a new MVP or a change to its agreed outcome or scope, start with [the planning workflow](planning.md).

Delivery is **local**: develop, verify and integrate on the local machine, and push once, when the whole MVP is done. A task needs no pull request and no reviewer's approval.

## Sources of truth

| Question | Authority |
| --- | --- |
| What product are we building? | The current MVP's scope, `docs/product/mvp<N>.md` for the `mvp` of the manifest, then the selected task's plan |
| Which plan and dependencies belong to a task? | [backlog.json](../plans/backlog.json) |
| Is work available, claimed or done? | The local repository: `node scripts/agent-local.mjs next` |
| Why this architecture? | Applicable ADRs in `docs/adr/` |
| What proves completion? | Plan acceptance criteria, recorded evidence and a passed local gate on the task's commits |

The local repository holds the state, and every worktree of it sees the same:

- **Integration branch**, named by `integration_branch` in the manifest (`mvp<N>`). Finished tasks accumulate here. It starts from main and is what the remote receives at the end. Nobody commits to it directly and no worktree checks it out.
- **Done:** the task's completed plan is on the integration branch.
- **Claimed:** the branch `task/<id>` exists (`task/cap-001`).

A tracker issue, where a task has one, describes the task; its labels are not updated during local delivery and prove nothing about progress. Task identifiers are not issue numbers.

## Select and claim

1. Read root and applicable nested `AGENTS.md` files.
2. Run `node scripts/agent-local.mjs next`. It lists every unfinished task as `READY`, `CLAIMED`, `WAIT` (a dependency is not on the integration branch) or `BLOCKED` (the task's `external_blocker`).
3. Claim one ready task: `node scripts/agent-local.mjs claim <ID>`. The command creates `task/<id>` from the integration branch; Git refuses a second claim. Switch your worktree to that branch.
4. Read the plan, its ADRs, relevant contracts and the completion notes of its dependencies. Move the plan from `planned/` to `active/`.

One task per branch. A task delivers its backend, contracts, UI and tests together where applicable; split oversized work into explicitly mapped tasks before starting.

## Implement

Resolve Proposed ADRs the task needs and mark them Accepted in the task. Record alternatives and consequences; explicitly supersede affected portions of older decisions. Routine in-scope design choices are yours. Ask only for missing user-owned facts or scope changes, and keep independent work moving.

Change the manifest and the plan together if the task contract changes.

Iterate with `make lint` and `make test` (nothing running). Give each worktree its own isolated environment (ports, data, a git-ignored `.env`), because other worktrees run their own.

Validate through the public behaviour named in the plan. UI rendering alone does not prove persistence; unit tests alone do not prove cross-component behaviour. Record failures and environmental blockers accurately. Real-source credentials stay outside Git and logs.

## Gate and integrate

No independent reviewer follows you: the gate and your own check of every acceptance criterion against evidence are what stands between the task and the integration branch.

1. Commit the work, then run the gate through the helper, which records a pass for that commit:

   ```bash
   node scripts/agent-local.mjs gate
   ```

   It runs `make pr-check`. A failed gate records nothing.
2. Record the evidence in the plan and move it to `completed/`. For every change a user can see, take a screenshot of the running product on the gated commit, save it as `docs/evidence/<ID>/<what-it-shows>.png` and link it from the plan's Evidence section with a one-line caption. A task with nothing to see records the command or API output instead and says so. Where the session has no way to take a screenshot, the Evidence section says that plainly. Commits after the gate may change documentation only; a runtime change needs the gate again. [`scripts/agent-scope.mjs`](../../scripts/agent-scope.mjs) holds that rule.
3. Integrate:

   ```bash
   node scripts/agent-local.mjs finish <ID>
   ```

   It refuses a dirty or foreign branch, a missing completed plan, a second task's plan in the same branch, and a runtime change without a covering gate. If the integration branch moved meanwhile, merge it into your branch and gate again. Then it fast-forwards the integration branch to your commit. Nothing is pushed.

A documentation task needs no gate.

## Report

After every `finish`, give the owner a status update, then select the next task if you were asked to process the queue:

- **Added:** what a user can now do, in plain words.
- **Screenshots:** each one shown with its caption, or the output recorded in its place.
- **Verified:** the acceptance criteria checked against evidence, and the gate result with its commit.
- **Try it:** the two or three steps by which the owner sees it working.
- **Next:** the output of `node scripts/agent-local.mjs next`, and any follow-up recorded in Completion Notes.

## Gates

| Gate | When | Stages |
| --- | --- | --- |
| `make pr-check` | every task, before `finish` | `FAST_STAGES` of the Makefile: lint, the agent structure check and the tests, then whatever the product needs on every task (a clean bootstrap, acceptance, contracts, browser tests) |
| `make premerge-check` | once on the integration branch, before the push; earlier for a task that changes shutdown, backup, upgrade or the release artifacts | `RESILIENCE_STAGES` of the Makefile: operations, backup/restore, upgrade, build and verification of the release artifacts |

A gate stage is a make target; a task that adds a kind of check adds its stage. A new repository has no product checks: `make test` fails until the first runtime task puts its tests there, and `make premerge-check` fails until a task gives it stages. Each gate prints the duration of every stage, also after a failure.

## Owner acceptance

When every task of the MVP is on the integration branch, the owner tests the product before anything is pushed.

Write `docs/product/mvp<N>-test.md`:

- how to start the product from the integration branch;
- a checklist in journey order, built from the acceptance scenarios of the MVP's scope and the "Try it" steps of every task: what to do, and what the owner should see;
- the failure cases to try;
- what cannot be tested by hand, and why.

Start the product, hand the owner the list and stop. Each failure the owner reports becomes a task: a plan from the template, registered in the manifest, delivered through this workflow. Update the checklist and hand it back. Done when the owner says the MVP passes and the test document records that with the date and the tested commit.

## Push when the MVP is done

When the owner has accepted the MVP:

1. Run `make pr-check` and `make premerge-check` on the integration branch's head.
2. Push the integration branch and open one pull request to main with Summary, Evidence and Merge Danger.
3. The hosted check `Agent structure` runs `make agent-check` on it. A failed, missing, cancelled or skipped check is not a pass.
4. Merge when the checks are green, then close the task issues, where there are any, with a link to the merge.

Without a remote, the owner decides how main receives the integration branch.
