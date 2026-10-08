# Milestone planning workflow

Use this process when planning a new milestone or materially changing an agreed milestone's outcome or scope. A small addition takes the short path: [Plan a feature](#plan-a-feature). Planning produces an agreed product scope and an executable backlog; task delivery follows [workflow.md](workflow.md), and the milestone's acceptance [acceptance.md](acceptance.md).

The base branch, throughout, is the one `node scripts/agent-local.mjs base` prints.

The owner decides the user outcome and accepts the scope and tradeoffs. Agents investigate, recommend a scope, prepare task plans and resolve routine engineering choices. Reuse decisions already made in the conversation; ask only for missing owner decisions and continue independent research meanwhile.

```mermaid
flowchart TD
    A[Inspect the current product] --> B[Choose the user outcome]
    B --> C[Map the user journey]
    C --> D[Agree the smallest useful scope]
    D --> E[Resolve major uncertainties]
    E --> F[Prepare tasks and dependencies]
    F --> G{Ready for implementation?}
    G -->|Gaps| E
    G -->|Yes| H[Claim, implement, gate, integrate]
```

The research note carries the planning status as the line under its title: `Planning status: stage <n> closed on <date>; next: stage <n+1>.` Update it whenever a stage closes; a session that resumes planning starts from that line.

## 1. Establish the baseline

Inspect the current delivery state using the [agent workflow's sources of truth](workflow.md#sources-of-truth). Identify the branch and commit being assessed, including changes integrated locally but absent from the base branch. Read the previous milestone's scope, acceptance evidence, limitations and the Notes of its tasks. Include available user feedback and pilot findings, and the improvement reports under `docs/product/improvements/`: a proposal the owner marked "later" is a candidate, and one marked "no" stays rejected for the reason recorded.

For the first milestone there is no previous one: the baseline is the owner's account of the users and their problem, any existing code, and the [product vision](../product/vision.md), which you write from that account and the owner confirms. Write its core idea as the Purpose of [AGENTS.md](../../AGENTS.md).

Record the findings in `docs/product/milestone<N>-research.md`. Under the status line, open it with the date, the revision inspected and whether any tests were rerun, and mark it as research evidence, not an implementation plan. Then cover what the product delivers today, the evidence boundaries, a table pairing each piece of evidence with the candidate improvement it suggests, and a proposed boundary for the discussion. Distinguish freshly verified behavior, reported evidence and assumptions; distinguish fake-source tests from real-source validation. Carry unfinished work and external blockers forward explicitly.

Then survey existing solutions: products and open-source projects that serve the same users or the same job. The first milestone, and a milestone that takes the product in a new direction, get the full survey with a web search. Every other milestone researches the delta: read the earlier research notes (`docs/product/milestone<k>-research.md`) and the improvement reports first, reuse the findings that still hold, and search only for a new question, stale evidence (older than about six months, or known to have changed), a product area not covered before, or a meaningful development.

Add an "Existing solutions" section to the note with, for each one, a link, what it does, where it overlaps with this product, and what it solves better or differently. Record what was **reused**, with the note and the date it comes from, and what was **refreshed or added**, with the date and the reason. Name the ideas worth adopting and the solutions that make part of this product unnecessary. Cite every claim to a page you opened; mark anything you could not verify as unverified.

Done when the note identifies what users can do today, the important unmet needs, and the evidence or uncertainty behind each candidate improvement, and you have reported to the owner the closest existing solutions, their similarities and every approach of theirs that is better than the current one.

## 2. Choose one user outcome

Recommend an outcome based on user value, delivery effort, dependencies and uncertainty. Have the owner choose the target user and priority. Express the outcome as: "A [user] can [complete a job], demonstrated by [observable result]."

For example: "A Capacity Manager completes two consecutive weekly risk and demand reviews in the product, retaining decisions, evidence, owners and follow-up dates instead of maintaining a separate review spreadsheet." Derive features from the chosen job.

Create `docs/product/milestone<N>.md` with an "Outcome" section: the outcome sentence, the target user and priority the owner chose, and why it matters.

Done when the owner has selected an outcome and `milestone<N>.md` records it with the reason it matters.

## 3. Map the journey and agree scope

Describe the user's starting situation, actions, decisions and final result. Include applicable failure cases such as missing or stale data, insufficient permissions, concurrent changes and restarts. Use a diagram or a small prototype when it resolves a concrete uncertainty.

Where the outcome is something the user sees, a prototype is required: build it at real size, on every device and screen size the milestone targets, with realistic content, and have the owner look at it there and approve it. A design approved on a large mockup and built for a phone is the costliest mistake this workflow can make: it surfaces only after every task is delivered.

Complete the draft of `docs/product/milestone<N>.md`: after the outcome, the included capabilities, exclusions, acceptance scenarios, external prerequisites and evidence limits. Add a "Test budget" section: the size of the test data (how many users, records, machines) and how long the task gate and the full gate may take, as numbers. Record the two limits as `budgets` in [backlog.json](../plans/backlog.json); the gate measures itself against them. State the release impact of each unresolved prerequisite. Present the complete proposal and its tradeoffs for the owner's scope decision. Once agreed, state the milestone in one sentence under Product scope in AGENTS.md.

Done when the agreed scope describes a complete useful workflow and observable success, with explicit exclusions and a test budget, and the owner has approved the prototype of a visible outcome on its target devices. Planning ahead may proceed while the current milestone is active; the draft leaves its delivery scope and queue as they are.

## 4. Resolve major uncertainties

Investigate assumptions that could invalidate the outcome or materially change its cost. Use bounded research or a prototype with a specific question and exit criterion. Record unresolved dependencies, who can resolve them and which tasks they block.

Create Proposed [ADRs](../adr/README.md) for significant architecture choices; for the first milestone these include the stack and the architecture principle. Each decision has an owning task, which resolves and accepts it before implementing dependent behavior. Fill Stack, Architecture principle and the product's own rules in AGENTS.md from the Proposed ADRs. Keep routine implementation choices in the task plan. If findings change the agreed outcome or scope, return to the owner with a revised proposal.

Done when each material uncertainty is resolved or assigned an explicit blocking condition and next action.

## 5. Prepare the delivery backlog

Split the scope into complete, testable features, and keep the tasks few and large. Every task pays a fixed price in claiming, gating, review and reporting, so a task is at least about an hour of an agent's work: merge a smaller one into the task whose component it touches. The acceptance task and a task that only unblocks an external dependency are the exceptions. Say in the handoff how many tasks the milestone has and why none of them could be merged. Each task includes its contracts, owning components, UI and tests where applicable; its plan says which tests run in the task gate and which are written for the end of the milestone. Use the [task template](../plans/template.md) for plans in `docs/plans/planned/`, with observable acceptance criteria, failure behavior and affected components; the manifest alone holds dependencies and ADRs. Keep plans short: what done means, not how to get there. A task with a user journey draws it as its Flow, a Mermaid flowchart with its failure paths; a task without one leaves the section out.

Map every milestone acceptance scenario to the task or tasks that deliver and verify it. Include the necessary authorization, migrations, operations, upgrade, backup/restore and final release acceptance work. The last task of the milestone is its [acceptance task](acceptance.md#the-acceptance-task): it depends on every other task, exercises the assembled user journey on the actual release artifacts, and delivers `docs/product/milestone<N>-test.md` with the milestone review and the owner's acceptance. Keep real-source pilot evidence separate from fixture acceptance. The first task of the first milestone bootstraps the development platform: it gives `make lint` and `make test` their product checks, and the full and the resilience [gate](orchestration.md#gates) their stages, or declares `none` for one that does not apply to this product. It names the milestone's slow stages up front, one make target per component that finds its tests by where they lie, so that later tasks add test files and leave the Makefile alone. In a later milestone the first task that needs a new stage does the same.

When preparing the agreed delivery queue, map stable task IDs, plans, tracker issues, dependencies and ADRs in [backlog.json](../plans/backlog.json):

```json
{
  "id": "CAP-001",
  "title": "Bootstrap the development platform",
  "slug": "bootstrap-development-platform",
  "issue": null,
  "depends_on": [],
  "adrs": ["docs/adr/001-title.md"],
  "external_blocker": null
}
```

The plan is `docs/plans/planned/<id>-<slug>.md`. Register a new task with `"issue": null`: stage 6 creates the issues and records their numbers. `external_blocker` says what blocks the task from outside and who can resolve it. Reuse unfinished tasks with their existing IDs, issues and blockers. Preserve completed plans and their evidence.

Add a "Task dependencies" section to `docs/product/milestone<N>.md` with a Mermaid graph of all the milestone's tasks: one node per task, one edge per `depends_on` entry of the manifest, and nothing else.

Then run `node scripts/agent-summary.mjs`. It writes `docs/product/milestone<N>-summary.html`, the implementation summary for the owner: the scope, the tasks in layers by dependency, from the manifest, and every unfinished task with its goal, acceptance criteria and flow, followed by their ADRs. Open it for the owner. The page is a view of the plans: change a plan and regenerate, never edit the page.

Cut the tasks along components, so that tasks of one round touch different files: one for the server, one for each client, not one per layer of the same feature. A plan whose task adds a stage or a target to the Makefile names `Makefile` under Affected Components: [a parallel round](orchestration.md#a-parallel-round) takes one such task at most. Give a task only the dependencies it cannot start without: tasks that do not depend on each other are delivered in parallel, and a chain of convenience makes the whole milestone wait in line.

Done when every included capability has an owner task and a proof of completion, every task with a user journey has its Flow, the owner has the implementation summary, and the dependency graph in `milestone<N>.md` matches `depends_on` in the manifest, with no cycles or hidden prerequisites.

## 6. Check readiness and hand off

Before switching delivery to the next milestone:

- Record the agreed scope and exact starting revision; account for unfinished work from the previous milestone.
- Update the manifest's `milestone` and `integration_branch` together with the delivery instructions: the product scope and the repository map of [AGENTS.md](../../AGENTS.md). Coordinate this transition after the active queue is finished or explicitly handed off; preserve its claims and branches.
- Commit the planning documents on the base branch and run `node scripts/agent-local.mjs start`, which creates the integration branch `milestone<N>` from it.
- Where the manifest names a `repository`: run `node scripts/agent-issues.mjs sync`, which creates the GitHub milestone, the status labels and one issue per task and writes the issue numbers into the manifest and the plans; regenerate the implementation summary; commit both on the base branch and run `node scripts/agent-local.mjs start` again, which fast-forwards the still unclaimed integration branch to that commit. Then push the base branch and run `node scripts/agent-local.mjs publish`, which pushes the integration branch and gives every issue its status.
- Check every milestone acceptance scenario against the task mapping, including failure and release scenarios.
- Ensure every unresolved blocker is visible and independent tasks remain selectable. Defer a release prerequisite only through an explicit scope decision, preserving the uncompleted work.
- Run `make agent-check`, `bash tests/integration/check-docs.sh` and `git diff --check` after preparing the queue. `make agent-check` is the structure check of the backlog, which every task gate repeats as `make structure-check`, plus the tests of the agent tooling, which a scaffold update may have changed. These validate structure, not product acceptance or the value of the chosen scope.
- Run `node scripts/agent-local.mjs next` in the delivery checkout and confirm that readiness matches the intended dependencies. With GitHub issues, `node scripts/agent-issues.mjs sync --check` passes.

Planning is ready for implementation when these checks pass and the handoff identifies the first ready task, and remaining blockers. Continue through [the delivery workflow](workflow.md#deliver-one-task); keep gate and integration rules there as the single source of truth.

## Plan a feature

The level above QUICK on the ladder of [How work enters](../../AGENTS.md#how-work-enters): a small planned product addition that needs no new architecture decision and fits one plan and one pull request, and whatever fails a QUICK condition but fits these limits. A request that is larger (more than three separately deliverable changes), needs an ADR, or falls under an agreed exclusion is a milestone's work: say which applies, stop, and plan it through the six stages. The effort stays proportional to the feature: ask and present only where the answer changes what is built.

1. **Clarify.** State the feature as "A [user] can [do something], demonstrated by [observable result]". Have the owner confirm the sentence only when the request leaves the behaviour ambiguous or a clarification would change what is built.
2. **Check the fit.** Read the current scope with its exclusions, the ADRs, the code the feature touches, and the improvement report the feature comes from, where `docs/product/improvements/` has one. Continue only when it passes the limits above. A request that meets every QUICK condition, one clear, localized, low-risk change that follows an existing pattern, is offered `/kordal-quick` instead, unless a milestone is active and the change touches a file it has changed ([How work enters](../../AGENTS.md#how-work-enters)): `/kordal-quick` refuses that one, so it stays here and joins the milestone as a one-task feature.
3. **Place.** Run `node scripts/agent-local.mjs phase`, the one test of [How work enters](../../AGENTS.md#how-work-enters), before changing the manifest:
   - **`between`** (nothing is in progress): the feature stands alone. Write **one** plan, `docs/plans/features/<slug>.md`, from the [task template](../plans/template.md), with the feature's sentence as its title, observable acceptance criteria and failure behaviour, and a Flow where it has a user journey. It gets no task ID, no manifest entry, no integration branch and no issue of its own. Present it for the owner's approval only when the fit is in doubt or the request was ambiguous. Deliver it by [A standalone feature](acceptance.md#a-standalone-feature).
   - **`delivering`** (a milestone is in progress, or awaits its pull request): the feature joins it as tasks. Write as few plans as the feature allows, three at most, from the task template, numbered after the highest task ID; present them for approval when there is more than one or the fit is in doubt. Add the tasks to [backlog.json](../plans/backlog.json) with `"issue": null`, record the feature under "Added features" in `docs/product/milestone<N>.md` (the date, the sentence and the task IDs), and add the tasks to the acceptance task's `depends_on`, unless that task is already claimed. `claim` the first feature task, on its own, switch to its branch and commit the plans, the manifest and the scope there; the task stays claimed for delivery. With GitHub issues that claim creates the issue of every feature task and writes the numbers into the manifest and the plans: they are part of that commit. A feature that joins a milestone the owner has already accepted repeats the owner's test: say so before writing the plans. Then run `make agent-check` and `bash tests/integration/check-docs.sh`, and name the first task with the output of `node scripts/agent-local.mjs next`. A feature gets no implementation summary page: that is a milestone's artifact.

Done when the owner has approved the plans that needed approval and either the standalone feature is under way on its branch, or the checks pass and `next` shows the feature's first task as claimed or ready.
