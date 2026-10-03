# Acceptance and the pull request

For the session that runs a milestone's acceptance task, carries a standalone feature's acceptance, or opens the pull request. The task itself is delivered by [workflow.md](workflow.md), which also holds the rules of the [gates](workflow.md#gates) run here.

## The acceptance task

The last task of every milestone is its acceptance task. It depends on every other task and delivers `docs/product/milestone<N>-test.md`. Claim it like any task; its branch holds the whole milestone. It runs in four parts.

### Full check

Everything the tasks did not run, once, on the whole milestone:

1. Bring the base branch (`node scripts/agent-local.mjs base`) in when it moved: `git fetch` where the repository has a remote, and merge `origin/<base>`, or the local base branch without a remote, into this branch where it holds commits this branch lacks. The owner then accepts what the base branch will hold after the merge.
2. `node scripts/agent-local.mjs gate pr-check`, then `node scripts/agent-local.mjs gate premerge-check`: every slow suite, the ones the tasks wrote included.
3. Start the product and walk every task's Flow as a user would, on each device the milestone targets: the journeys and their failure paths.

Each failure becomes a task, [added and delivered through the workflow](workflow.md#add-a-task-during-delivery); then merge the integration branch into the acceptance branch and run the failed part again. Done when both gates cover the current head and every Flow has been walked on it.

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

A feature planned while nothing else is in progress has its own integration branch, `feature/<slug>`, and no separate acceptance task: its last task carries the acceptance. Deliver that task by [Deliver one task](workflow.md#deliver-one-task) up to its review, then on its branch:

1. Run the full check as the acceptance task does: bring the base branch in when it moved, run both gates, then walk the feature's Flows in the running product. Where the feature has more than one task, review the whole feature, the diff from the base branch, graded as the milestone review: fix its high and medium findings on this branch and gate again. Record it in the task's Review.
2. Write `docs/product/feature-<slug>-test.md`: how to start the product from this branch, a checklist of what to do and what the owner should see, and the failure cases to try. Start the product, hand the owner the list and stop.
3. Fix what the owner reports on this branch, run both gates again and hand the list back. When the owner says the feature passes, record that in the test document with the date and the tested commit, complete the plan and finish as [Finish](#finish) says, `git fetch` first: the gates cover what the owner tested, and the documentation recorded since needs no new gate.

## Open the pull request

The pull request is the release of the milestone or the feature: open it on the owner's command, when `next` lists nothing and the test document, `docs/product/milestone<N>-test.md` or `docs/product/feature-<slug>-test.md`, records the owner's acceptance, and for a milestone its review.

1. `git fetch`. When `origin/<base>` has commits the integration branch lacks (`git log --oneline <integration>..origin/<base>` prints them), stop and show them to the owner: they arrived after the acceptance, as a quick change or a hotfix does. The owner decides: accept that GitHub merges them with the milestone, a combination nothing tested; or have a task bring them in. That task is [added](workflow.md#add-a-task-during-delivery), merges `origin/<base>` on its branch and completes the queue: run both gates there, have the owner repeat the acceptance for what changed, record it in the test document, then `finish`.
2. With a GitHub mirror, run `node scripts/agent-issues.mjs sync --check`: the mirror matches before the pull request names its issues. `node scripts/agent-local.mjs publish` repairs a difference.
3. Open one pull request from the integration branch, which `finish` has pushed, to the base branch, with the Summary and Merge Danger of the [template](../../.github/pull_request_template.md); the Summary lists every task with its issue.
4. The hosted check `Agent structure` runs `make agent-check` and the documentation check on it. A failed, missing, cancelled or skipped check is not a pass.
5. Report the pull request and the state of its checks to the owner, who merges it. What reaches the base branch after this fetch is not seen here: the owner checks that the pull request is up to date with it before merging.

Without a GitHub mirror, the owner decides how the base branch receives the integration branch.
