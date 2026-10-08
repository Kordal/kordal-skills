# Acceptance and the pull request

For the session that runs a milestone's acceptance task, delivers a standalone feature, or opens a milestone's pull request. The task itself is delivered by [workflow.md](workflow.md), and the rules of the [gates](orchestration.md#gates) run here are in orchestration.md.

## The acceptance task

The last task of every milestone is its acceptance task. It depends on every other task and delivers `docs/product/milestone<N>-test.md`. Claim it like any task; its branch holds the whole milestone. It runs in four parts.

### Full check

Everything the tasks did not run, once, on the whole milestone:

1. Bring the base branch (`node scripts/agent-local.mjs base`) in when it moved: `git fetch` where the repository has a remote, and merge `origin/<base>`, or the local base branch without a remote, into this branch where it holds commits this branch lacks. The owner then accepts what the base branch will hold after the merge.
2. `node scripts/agent-local.mjs gate pr-check`, then `node scripts/agent-local.mjs gate premerge-check`: every slow suite, the ones the tasks wrote included.
3. Start the product and walk every task's Flow, and the acceptance criteria of each task without one, as a user would, on each device the milestone targets: the journeys and their failure paths.

Each failure becomes a task, [added and delivered through the workflow](workflow.md#add-a-task-during-delivery); then merge the integration branch into the acceptance branch and run the failed part again. Done when both gates cover the current head and every Flow and criterion has been walked on it.

### Milestone review

Review the whole milestone before the owner tests it: the diff from the base branch to this branch, on the same two axes as a task, each by an independent reviewer with a fresh context. Standards now covers how the tasks fit together: duplicated logic, inconsistent naming and interfaces between tasks, a decision one task made and another ignored. Spec is every acceptance scenario of `docs/product/milestone<N>.md` against the assembled product.

Grade each confirmed finding. **High:** a wrong result, lost data or a security hole. **Medium:** an acceptance scenario not met, or a defect on a path users reach. **Low:** names, comments, duplication, documentation. High and medium findings block acceptance: each becomes a task, delivered through the workflow. Low findings are listed under "Follow-up" in the test document for the owner to decide.

After the fix tasks, merge the integration branch into the acceptance branch, run both gates again and review once more: only the diff of those fix tasks, not the milestone again. Done when that review has no high or medium finding; record both reviews, with their commits and findings, in the "Review" section that opens the test document.

### Owner acceptance

Write the rest of `docs/product/milestone<N>-test.md`:

- how to start the product from this branch;
- a checklist in journey order, built from the acceptance scenarios of the milestone's scope and the "Try it" steps of every task: what to do, and what the owner should see;
- the failure cases to try;
- what cannot be tested by hand, and why.

Start the product, hand the owner the list and stop: the milestone waits for the owner's answer. Each failure the owner reports becomes a task; when it is finished, merge the integration branch, run both gates again, update the checklist and hand it back. Done when the owner says the milestone passes and the test document records that with the date and the tested commit. After the owner's test only documentation may change on this branch: a runtime change is a new commit for the owner to test.

### Finish

Complete the plan, its Review naming the milestone review of the test document. `git fetch` again, then run `node scripts/agent-local.mjs finish <ID>`. It demands that a `pr-check` and a `premerge-check` cover the runtime state the owner tested, and refuses while the base branch, the local one or `origin/<base>` as last fetched, has commits this branch lacks: merge it as step 1 of the full check says, run both gates, and hand a runtime change it brought back to the owner before finishing. Documentation recorded after the gates (the reviews, the checklist, the owner's acceptance) needs no new gate: `finish` runs the documentation check on it. After a runtime fix, `gate pr-check` and `gate premerge-check` run again; each returns at once, saying `reused`, when nothing runtime changed since it passed. Done when `finish` prints that the task is on the integration branch; tell the owner that the pull request is next.

## A standalone feature

A feature planned while nothing is in progress is one branch, one plan and one pull request: no backlog task, integration branch, GitHub issue, claim or `finish`. Its plan is `docs/plans/features/<slug>.md` ([Plan a feature](planning.md#plan-a-feature)). The owner's review and test happen on the pull request.

1. **Branch.** On a clean tree, `git fetch` and branch from the fetched base branch (`node scripts/agent-local.mjs base`): `git switch -c feature/<slug> --no-track origin/<base>`, or from the local base branch without a remote. Commit the plan first.
2. **Implement** every acceptance criterion and failure behaviour with the test that proves it, by the rules of step 2 of [Deliver one task](workflow.md#deliver-one-task): decisions, tests, budget and environment. A product decision the plan leaves open, or one that needs an ADR, stops the feature: it is a milestone's work.
3. **Gate.** `make task-check`, and `make pr-check` where `MILESTONE_STAGES` has stages that test what the feature changed. Note each result with its commit for the pull request's validation; a failure your change caused is fixed first.
4. **Review** the whole feature once: the diff from where it branched (`git diff origin/<base>...HEAD`, or the local base branch without a remote), both axes, by an independent reviewer with a fresh context, graded as the [milestone review](#milestone-review). Fix the high and medium findings, gate again, and record the review and what was done about each finding in the plan's Review.
5. **See it.** Where the change is visible to a user, start the product the cheapest way that shows it and walk the Flow, or the criteria, once. What it shows wrong returns to step 2.
6. **Complete.** Tick each criterion, fill the plan's Notes, add a line to [DECISIONS.md](../DECISIONS.md) for each non-obvious choice the feature made, and commit. Done when no criterion is unticked and neither Review nor Notes says Pending: no structure check reads a feature plan, so this is yours to hold.
7. **Pull request.** Push this branch only, without force, and open one pull request to the base branch with the [template](../../.github/pull_request_template.md)'s Summary and Merge Danger, then: the acceptance criteria, each with its proof; the validation results, a check not run reported as not run; how to see it, two or three steps; and `Closes #<number>` for a feature planned from an issue. Report its URL to the owner, who tests and merges.

## Open the pull request

The pull request is the release of the milestone: open it on the owner's command, when `next` lists nothing and the test document, `docs/product/milestone<N>-test.md`, records the owner's acceptance and the milestone review.

1. `git fetch`. When `origin/<base>` has commits the integration branch lacks (`git log --oneline <integration>..origin/<base>` prints them), stop and show them to the owner: they arrived after the acceptance, as a quick change or a hotfix does. The owner decides: accept that GitHub merges them with the milestone, a combination nothing tested; or have a task bring them in. That task is [added](workflow.md#add-a-task-during-delivery), merges `origin/<base>` on its branch and completes the queue: run both gates there, have the owner repeat the acceptance for what changed, record it in the test document, then `finish`.
2. With GitHub issues, run `node scripts/agent-issues.mjs sync --check`: the mirror matches before the pull request names its issues. `node scripts/agent-local.mjs publish` repairs a difference.
3. Open one pull request from the integration branch, which `finish` has pushed, to the base branch, with the Summary and Merge Danger of the [template](../../.github/pull_request_template.md); the Summary lists every task with its issue.
4. The hosted check `Agent structure` runs `make agent-check` and the documentation check on it. A failed, missing, cancelled or skipped check is not a pass.
5. Report the pull request and the state of its checks to the owner, who merges it. What reaches the base branch after this fetch is not seen here: the owner checks that the pull request is up to date with it before merging.

Without a `repository` in the manifest nothing was pushed: the owner decides how the base branch receives the integration branch.
