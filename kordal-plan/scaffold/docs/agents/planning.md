# MVP planning workflow

Use this process when planning a new MVP or materially changing an agreed MVP's outcome or scope. Planning produces an agreed product scope and an executable backlog; task delivery follows [workflow.md](workflow.md).

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

The research note carries the planning status as its first line after the title: `Planning status: stage <n> closed on <date>; next: stage <n+1>.` Update it whenever a stage closes; a session that resumes planning starts from that line.

## 1. Establish the baseline

Inspect the current delivery state using the [agent workflow's sources of truth](workflow.md#sources-of-truth). Identify the branch and commit being assessed, including changes integrated locally but absent from main. Read the previous MVP's scope, acceptance evidence, limitations and task Completion Notes. Include available user feedback and pilot findings.

For the first MVP there is no previous one: the baseline is the owner's account of the users and their problem, any existing code, and the [product vision](../product/vision.md), which you write from that account and the owner confirms.

Record the findings in `docs/product/mvp<N>-research.md`. Open it with the date, the revision inspected and whether any tests were rerun, and mark it as research evidence, not an implementation plan. Then cover what the product delivers today, the evidence boundaries, a table pairing each piece of evidence with the candidate improvement it suggests, and a proposed boundary for the discussion. Distinguish freshly verified behavior, reported evidence and assumptions; distinguish fake-source tests from real-source validation. Carry unfinished work and external blockers forward explicitly.

Then survey existing solutions with a web search: products and open-source projects that serve the same users or the same job. Add an "Existing solutions" section to the note with, for each one, a link, what it does, where it overlaps with this product, and what it solves better or differently. Name the ideas worth adopting and the solutions that make part of this product unnecessary. Cite every claim to a page you opened; mark anything you could not verify as unverified.

Done when the note identifies what users can do today, the important unmet needs, and the evidence or uncertainty behind each candidate improvement, and you have reported to the owner the closest existing solutions, their similarities and every approach of theirs that is better than the current one.

## 2. Choose one user outcome

Recommend an outcome based on user value, delivery effort, dependencies and uncertainty. Have the owner choose the target user and priority. Express the outcome as: "A [user] can [complete a job], demonstrated by [observable result]."

For example: "A Capacity Manager completes two consecutive weekly risk and demand reviews in the product, retaining decisions, evidence, owners and follow-up dates instead of maintaining a separate review spreadsheet." Derive features from the chosen job.

Create `docs/product/mvp<N>.md` with an "Outcome" section: the outcome sentence, the target user and priority the owner chose, and why it matters.

Done when the owner has selected an outcome and `mvp<N>.md` records it with the reason it matters.

## 3. Map the journey and agree scope

Describe the user's starting situation, actions, decisions and final result. Include applicable failure cases such as missing or stale data, insufficient permissions, concurrent changes and restarts. Use a diagram or a small prototype when it resolves a concrete uncertainty.

Complete the draft of `docs/product/mvp<N>.md`: after the outcome, the included capabilities, exclusions, acceptance scenarios, external prerequisites and evidence limits. State the release impact of each unresolved prerequisite. Present the complete proposal and its tradeoffs for the owner's scope decision.

Done when the agreed scope describes a complete useful workflow and observable success, with explicit exclusions. Planning ahead may proceed while the current MVP is active; the draft leaves its delivery scope and queue as they are.

## 4. Resolve major uncertainties

Investigate assumptions that could invalidate the outcome or materially change its cost. Use bounded research or a prototype with a specific question and exit criterion. Record unresolved dependencies, who can resolve them and which tasks they block.

Create Proposed [ADRs](../adr/README.md) for significant architecture choices; for the first MVP these include the stack and the architecture principle. Each decision has an owning task, which resolves and accepts it before implementing dependent behavior. Keep routine implementation choices in the task plan. If findings change the agreed outcome or scope, return to the owner with a revised proposal.

Done when each material uncertainty is resolved or assigned an explicit blocking condition and next action.

## 5. Prepare the delivery backlog

Split the scope into complete, testable features. Each task includes its contracts, owning components, UI and tests where applicable. Use the [task template](../plans/template.md) for plans in `docs/plans/planned/`, with observable acceptance criteria, failure behavior, dependencies, affected components and evidence requirements. Every plan has a "Flow" section: a Mermaid flowchart of the journey the task delivers, including its failure paths, or "None: <reason>" for a task with no user-facing journey.

Map every MVP acceptance scenario to the task or tasks that deliver and verify it. Include the necessary authorization, migrations, operations, upgrade, backup/restore and final release acceptance work. The final acceptance task exercises the assembled user journey on the actual release artifacts. Keep real-source pilot evidence separate from fixture acceptance. The first task of the first MVP bootstraps the development platform: it gives `make lint`, `make test` and the gates their product stages.

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

Add a "Task dependencies" section to `docs/product/mvp<N>.md` with a Mermaid graph of all the MVP's tasks: one node per task, one edge per `depends_on` entry of the manifest, and nothing else.

Then run `node scripts/agent-summary.mjs`. It writes `docs/product/mvp<N>-summary.html`, the implementation summary for the owner: the scope, the dependency graph drawn from the manifest, and every task with its goal, acceptance criteria and flow, followed by the ADRs. Open it for the owner. The page is a view of the plans: change a plan and regenerate, never edit the page. Regenerate it at stage 6, once the issues have their numbers.

Done when every included capability has an owner task and a proof of completion, every plan has its Flow, the owner has the implementation summary, and the dependency graph in `mvp<N>.md` matches `depends_on` in the manifest, with no cycles or hidden prerequisites.

## 6. Check readiness and hand off

Before switching delivery to the next MVP:

- Record the agreed scope and exact starting revision; account for unfinished work from the previous MVP.
- Update the manifest's `mvp` and `integration_branch` together with the delivery instructions: the product scope and the repository map of [AGENTS.md](../../AGENTS.md). Coordinate this transition after the active queue is finished or explicitly handed off; preserve its claims and branches.
- Commit the planning documents on main. Where the manifest names a `repository`, run `node scripts/agent-issues.mjs sync`: it creates the milestone, the status labels and one issue per task, and writes the issue numbers into the manifest and the plans. Commit those numbers.
- Create the integration branch `mvp<N>` from main. With a `repository`, push main and run `node scripts/agent-local.mjs publish`, which pushes the integration branch and gives every issue its status.
- Check every MVP acceptance scenario against the task mapping, including failure and release scenarios.
- Ensure every unresolved blocker is visible and independent tasks remain selectable. Defer a release prerequisite only through an explicit scope decision, preserving the uncompleted work.
- Run `make agent-check`, `bash tests/integration/check-docs.sh` and `git diff --check` after preparing the queue. These validate structure, not product acceptance or the value of the chosen scope.
- Run `node scripts/agent-local.mjs next` in the delivery checkout and confirm that readiness matches the intended dependencies. With a `repository`, `node scripts/agent-issues.mjs sync --check` passes.

Planning is ready for implementation when these checks pass and the handoff identifies the first ready task, remaining blockers and required evidence. Continue through [the delivery workflow](workflow.md); keep gate and integration rules there as the single source of truth.
