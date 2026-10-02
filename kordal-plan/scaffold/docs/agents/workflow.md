# Agent delivery workflow

For a new milestone or a change to its agreed outcome or scope, start with [the planning workflow](planning.md).

Delivery is **local**: develop, verify and integrate on the local machine. A task needs no pull request and no reviewer's approval; main receives one pull request, when the whole milestone is done.

## Sources of truth

| Question | Authority |
| --- | --- |
| What product are we building? | The current milestone's scope, `docs/product/milestone<N>.md` for the `milestone` of the manifest, then the selected task's plan |
| Which plan and dependencies belong to a task? | [backlog.json](../plans/backlog.json) |
| Is work available, claimed or done? | The local repository: `node scripts/agent-local.mjs next` |
| Why this architecture? | Applicable ADRs in `docs/adr/` |
| What proves completion? | Plan acceptance criteria, the recorded review and a passed local gate on the task's commits |

The local repository holds the state, and every worktree of it sees the same:

- **Integration branch**, named by `integration_branch` in the manifest: `milestone<N>`, or `feature/<slug>` for a standalone feature. Finished tasks accumulate here. It starts from main and becomes the milestone's pull request. Nobody commits to it directly and no worktree checks it out.
- **Done:** the task's completed plan is on the integration branch.
- **Claimed:** the branch `task/<id>` exists (`task/cap-001`).

## GitHub mirror

A manifest that names a `repository` has a mirror of this state on GitHub; a manifest without one is delivered without GitHub, and the rest of this section does not apply. The repository stays the source of truth: change the plan, never the issue.

- **Integration branch:** `claim` and `finish` push it, so GitHub holds every finished task. A push of this branch starts no hosted check.
- **Issues:** one per task, in the GitHub milestone `Milestone <N>`, its body generated from the plan. Each carries one status label, the state `next` shows: `status:waiting`, `status:blocked`, `status:ready`, `status:in-progress`, `status:done`. An issue closes when its task is on the integration branch.

[`scripts/agent-issues.mjs`](../../scripts/agent-issues.mjs) keeps the mirror: `claim` and `finish` run its `sync`, which changes only what differs on GitHub. For a task that has no issue yet it creates one and writes the number into the manifest and the plan of the checkout; commit those with the task. `node scripts/agent-issues.mjs sync --check` changes nothing and fails on any difference. When GitHub cannot be reached the local result stands, `next` reports that GitHub is out of sync, and `node scripts/agent-local.mjs publish` repairs it. Task identifiers are not issue numbers.

## Select and claim

1. Read root and applicable nested `AGENTS.md` files.
2. Run `node scripts/agent-local.mjs next`. It lists every unfinished task as `READY`, `CLAIMED`, `WAIT` (a dependency is not on the integration branch) or `BLOCKED` (the task's `external_blocker`).
3. Claim one ready task: `node scripts/agent-local.mjs claim <ID>`. The command creates `task/<id>` from the integration branch; Git refuses a second claim. Switch your worktree to that branch.
4. Read the plan, its ADRs, relevant contracts and the completion notes of its dependencies. Move the plan from `planned/` to `active/`.

One task per branch. A task delivers its backend, contracts, UI and tests together where applicable; split oversized work into explicitly mapped tasks before starting.

## Implement

Resolve Proposed ADRs the task needs and mark them Accepted in the task. Record alternatives and consequences; explicitly supersede affected portions of older decisions. Routine in-scope design choices are yours. Ask only for missing user-owned facts or scope changes, and keep independent work moving.

Change the manifest and the plan together if the task contract changes.

Iterate with `make lint` and `make test` (nothing running). Stay inside the milestone's test budget: the data size and the gate times its scope names. A single step that will run longer than the full gate's budget, such as a load, a measurement or a build, is a reason to stop and ask before it starts. Give each worktree its own isolated environment (ports, data, a git-ignored `.env`), because other worktrees run their own.

Validate through the public behaviour named in the plan. UI rendering alone does not prove persistence; unit tests alone do not prove cross-component behaviour. Record failures and environmental blockers accurately. Real-source credentials stay outside Git and logs.

## Gate and integrate

No independent reviewer follows you: the gate, the review and your own check of every acceptance criterion in the running product are what stands between the task and the integration branch.

1. Commit the work, then run the gate through the helper, which records a pass for that commit:

   ```bash
   node scripts/agent-local.mjs gate
   ```

   It runs `make task-check`, the fast gate. A failed gate records nothing.
2. Review the task's diff against the integration branch with a fresh context, as a reviewer who did not write it, on two axes. **Standards:** does the change follow `AGENTS.md`, the ADRs and the conventions of the code around it? **Spec:** does it deliver the plan's acceptance criteria and failure behaviour, and nothing outside its scope? Fix every confirmed finding; a runtime fix needs the gate again. Record in the plan's Review section the reviewed commit, who reviewed (the agent and its model), and each finding with what was done about it, or "No findings". `make agent-check` rejects a completed plan whose Review is pending.
3. Use what you built. For every change a user can see, start the product on the gated commit and walk the plan's Flow as a user would, in the browser or the client the product has: the journey and each failure path. A defect you find is fixed before the task goes on; a runtime fix needs the gate again. A task with nothing to see exercises its command or API instead.
4. Tick each acceptance criterion you have seen work, fill the Completion Notes and move the plan to `completed/`. Commits after the gate may change documentation only; a runtime change needs the gate again. [`scripts/agent-scope.mjs`](../../scripts/agent-scope.mjs) holds that rule.
5. Integrate:

   ```bash
   node scripts/agent-local.mjs finish <ID>
   ```

   It refuses a dirty or foreign branch, a missing or unreviewed completed plan, a second task's plan in the same branch, and a runtime change without a covering gate. If the integration branch moved meanwhile, merge it into your branch and gate again. Then it fast-forwards the integration branch to your commit and updates the GitHub mirror.

A documentation task needs no gate.

## Report

After every `finish`, give the owner a status update, then select the next task if you were asked to process the queue:

- **Added:** what a user can now do, in plain words.
- **Verified:** what you saw work in the running product, and the gate result with its commit.
- **Try it:** the two or three steps by which the owner sees it working.
- **Next:** the output of `node scripts/agent-local.mjs next`, and any follow-up recorded in Completion Notes.

With a GitHub mirror, post the same update on the task's issue: write it to a file outside the repository and run `node scripts/agent-issues.mjs comment <ID> <file>`.

## First look

The first task of a milestone that changes what a user sees ends with a stop. After its status update, leave the product running on every device the milestone targets, tell the owner how to reach it, and wait: the owner looks at the real thing before the rest is built on it. Record the owner's answer under "First look" in `docs/product/milestone<N>.md`, with the task and the date. A change the owner asks for is a change of scope: plan it before the queue continues.

## Gates

| Gate | When | Stages |
| --- | --- | --- |
| `make task-check` | every task, before `finish` | `TASK_STAGES` of the Makefile: lint, the agent structure check and the tests that run in a minute or two with nothing started |
| `make pr-check` | once, by the task that completes the queue: the acceptance task, or the last task of a standalone feature | The task gate, then `MILESTONE_STAGES`: the slow suites, such as a clean bootstrap, acceptance, contracts and browser tests |
| `make premerge-check` | once, with the full gate; earlier for a task that changes shutdown, backup, upgrade or the release artifacts | `RESILIENCE_STAGES` of the Makefile: operations, backup/restore, upgrade, build and verification of the release artifacts |

A gate stage is a make target; a task that adds a kind of check adds its stage, to the task gate when it is fast and to the milestone stages when it is slow. `finish` refuses the task that completes the queue without a passed `pr-check`, so the slow suites run once per milestone and never per task. What they find is fixed as a task of its own. A new repository has no product checks: `make test` fails until the first runtime task puts its tests there, and `make premerge-check` fails until a task gives it stages. Each gate prints the duration of every stage, also after a failure.

## Add a task during delivery

A task found during delivery (a review finding, a failure the owner reports, a split of oversized work) is added in the checkout that will deliver it: write its plan from the template, add it to the manifest, and `claim` it. With a GitHub mirror the claim creates its issue and writes the number into the manifest and the plan. Switch to its branch and commit the plan and the manifest there with the work.

## The acceptance task

The last task of every milestone is its acceptance task. It depends on every other task and delivers `docs/product/milestone<N>-test.md`. Claim it like any task; its branch holds the whole milestone. It runs in three parts.

### Milestone review

Review the whole milestone before the owner tests it: the diff from main to this branch, on the same two axes as a task. Standards now covers how the tasks fit together: duplicated logic, inconsistent naming and interfaces between tasks, a decision one task made and another ignored. Spec is every acceptance scenario of `docs/product/milestone<N>.md` against the assembled product.

Grade each confirmed finding. **High:** a wrong result, lost data or a security hole. **Medium:** an acceptance scenario not met, or a defect on a path users reach. **Low:** names, comments, duplication, documentation. High and medium findings become tasks, delivered through this workflow; low findings are listed under "Follow-up" in the test document for the owner to decide.

After the fix tasks, merge the integration branch into the acceptance branch and review once more: only the diff of those fix tasks, not the milestone again. Done when that review has no high or medium finding; record both reviews, with their commits and findings, in the "Review" section that opens the test document.

### Owner acceptance

Write the rest of `docs/product/milestone<N>-test.md`:

- how to start the product from this branch;
- a checklist in journey order, built from the acceptance scenarios of the milestone's scope and the "Try it" steps of every task: what to do, and what the owner should see;
- the failure cases to try;
- what cannot be tested by hand, and why.

Start the product, hand the owner the list and stop. Each failure the owner reports becomes a task; when it is finished, merge the integration branch, update the checklist and hand it back. Done when the owner says the milestone passes and the test document records that with the date and the tested commit. After the owner's test only documentation may change on this branch: a runtime change is a new commit for the owner to test.

### Finish

Run the full gates on the branch, which is what the owner tested: `node scripts/agent-local.mjs gate pr-check` and `node scripts/agent-local.mjs gate premerge-check`. Then `finish`.

## A standalone feature

A feature planned while nothing else is in progress has its own integration branch, `feature/<slug>`, and no separate acceptance task: its last task carries the acceptance. On that task's branch, after its walk through the product:

1. Review the whole feature, the diff from main, where the feature has more than one task; record it in the task's Review.
2. Write `docs/product/feature-<slug>-test.md`: how to start the product from this branch, a checklist of what to do and what the owner should see, and the failure cases to try. Start the product, hand the owner the list and stop.
3. Fix what the owner reports on this branch and gate again. When the owner says the feature passes, record that in the test document with the date and the tested commit, run `node scripts/agent-local.mjs gate pr-check`, and `gate premerge-check` where that gate has stages, and `finish`.

## Open the pull request when the work is done

When `next` lists nothing and the test document, `docs/product/milestone<N>-test.md` or `docs/product/feature-<slug>-test.md`, records the owner's acceptance, and for a milestone its review:

1. With a GitHub mirror, run `node scripts/agent-issues.mjs sync --check`: the mirror matches before the pull request names its issues.
2. Open one pull request from the integration branch, which `finish` has pushed, to main, with Summary and Merge Danger; the Summary lists every task with its issue.
3. The hosted check `Agent structure` runs `make agent-check` on it. A failed, missing, cancelled or skipped check is not a pass.
4. Report the pull request and the state of its checks to the owner, who merges it.

Without a GitHub mirror, the owner decides how main receives the integration branch.
