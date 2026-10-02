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
2. Record the evidence in the plan and move it to `completed/`. Commits after the gate may change documentation only; a runtime change needs the gate again. [`scripts/agent-scope.mjs`](../../scripts/agent-scope.mjs) holds that rule.
3. Integrate:

   ```bash
   node scripts/agent-local.mjs finish <ID>
   ```

   It refuses a dirty or foreign branch, a missing completed plan, a second task's plan in the same branch, and a runtime change without a covering gate. If the integration branch moved meanwhile, merge it into your branch and gate again. Then it fast-forwards the integration branch to your commit. Nothing is pushed.

A documentation task needs no gate. Report what was integrated, the validation and any follow-up; then select the next task if you were asked to process the queue.

## Gates

| Gate | When | Stages |
| --- | --- | --- |
| `make pr-check` | every task, before `finish` | `FAST_STAGES` of the Makefile: lint, the agent structure check and the tests, then whatever the product needs on every task (a clean bootstrap, acceptance, contracts, browser tests) |
| `make premerge-check` | once on the integration branch, before the push; earlier for a task that changes shutdown, backup, upgrade or the release artifacts | `RESILIENCE_STAGES` of the Makefile: operations, backup/restore, upgrade, build and verification of the release artifacts |

A gate stage is a make target; a task that adds a kind of check adds its stage. A new repository has no product checks: `make test` fails until the first runtime task puts its tests there, and `make premerge-check` fails until a task gives it stages. Each gate prints the duration of every stage, also after a failure.

## Push when the MVP is done

When every task of the MVP is on the integration branch:

1. Run `make pr-check` and `make premerge-check` on its head.
2. Push the integration branch and open one pull request to main with Summary, Evidence and Merge Danger.
3. The hosted check `Agent structure` runs `make agent-check` on it. A failed, missing, cancelled or skipped check is not a pass.
4. Merge when the checks are green, then close the task issues, where there are any, with a link to the merge.

Without a remote, the owner decides how main receives the integration branch.
