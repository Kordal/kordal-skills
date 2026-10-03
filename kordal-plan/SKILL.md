---
name: kordal-plan
description: Plan the next milestone - a substantial outcome, several coordinated changes or a new architecture decision - through the six-stage planning workflow; in a new project, scaffold the agent structure first.
disable-model-invocation: false
argument-hint: "[milestone number or outcome idea | feature <idea or issue number> | update]"
---

Plan what the project builds next. `$ARGUMENTS` picks the mode:

| `$ARGUMENTS` | Mode |
| --- | --- |
| empty | Plan the milestone after the latest `docs/product/milestone<N>.md`, or Milestone 1 when none exists |
| a milestone number or an outcome idea | Plan that milestone |
| `feature <idea or issue number>` | [Plan a feature](#plan-a-feature) |
| `update` | [Update a scaffolded project](#update-a-scaffolded-project) |

The project's `docs/agents/planning.md` is the single source of truth for the stages, their artifacts and their "Done when" criteria. This skill adds only how to run it in a Claude session. Where the file is missing, [scaffold the project](#scaffold-a-new-project) first. Then read it: the whole file for a milestone, its section "Plan a feature" for a feature; an update reads neither.

A milestone is the top of the ladder QUICK → FEATURE → MILESTONE. An outcome idea that fits one to three tasks and needs no new architecture decision is offered `/kordal-plan-feature` before stage 1. One clear, localized, low-risk change is offered `/kordal-quick`, unless it touches a file an active milestone has changed: that one is a feature too.

The base branch, here as there, is the one `node scripts/agent-local.mjs base` prints. A helper that answers `base` or `phase` with its usage text belongs to a scaffold older than this skill: a milestone or a feature is planned after `/kordal-plan-update`, so tell the owner, and stop. The update itself runs on that helper, as its step 1 says.

## Scaffold a new project

The scaffold is the agent structure this workflow runs on: `AGENTS.md`, `CLAUDE.md`, `docs/agents/` (planning, task delivery, acceptance), `docs/plans/` (manifest, template, `planned/`, `active/`, `completed/`), `docs/adr/`, `docs/product/vision.md`, the delivery scripts and the GitHub issue mirror with their tests, the gate runner, the documentation check, the Makefile gates and the hosted structure check.

1. Run `bash ${CLAUDE_SKILL_DIR}/bootstrap.sh` in the project root (`bootstrap.sh` sits beside this file). It initializes Git when needed, reports every file as `created` or `kept`, detects the base branch and records one other than `main` as `base_branch` in the manifest it created (the report line `base`), and records the scaffold version in `docs/agents/scaffold-version`.
2. Merge each `kept` file by hand with its counterpart in `${CLAUDE_SKILL_DIR}/scaffold/`: an existing Makefile gains the scaffold's variables and targets, an existing `AGENTS.md` gains its routing table, its delivery-workflow section and its repository map. Do what a `WARN` line of the report asks, such as adding `base_branch` to a manifest that was kept.
3. Run `make agent-check` and `bash tests/integration/check-docs.sh`. Done when both pass; then commit the scaffold on the base branch as its own commit and show the owner the bootstrap report.
4. A project without an `origin` remote: ask the owner once, with `AskUserQuestion`, whether to create a private GitHub repository for it, recommending yes. On yes, run `gh repo create <folder name> --private --source . --remote origin --push`, set `"repository": "<owner>/<name>"` in `docs/plans/backlog.json` and commit. A project that already has a GitHub `origin` gets that `repository` without the question. On no, the manifest stays without `repository` and the project is delivered without GitHub.
5. A project with hosted workflows that run on a push to the base branch (`.github/workflows/*.yml` with `on: push`): planning pushes the base branch with documents only, and a path filter that ignores `**.md` alone still fires on `docs/plans/backlog.json` and the summary page. Show the owner each such workflow and add `docs/**` and `scripts/agent-*` to its `paths-ignore` on their yes, so that the base branch builds and publishes only when product code reaches it: at the milestone's merge.

The scaffold's placeholders are HTML comments naming the planning stage that fills them. Replace each comment at that stage, so `AGENTS.md` and `vision.md` carry no placeholder at the stage 6 handoff.

## Plan a feature

When `$ARGUMENTS` starts with `feature`, plan the rest of it by the "Plan a feature" section of `docs/agents/planning.md` instead of the six stages, with effort in proportion to the feature. A project that has no agreed milestone yet plans its first milestone instead: say so.

- **From an issue.** Where the rest is an issue's number or URL, read it (`gh issue view <number> --comments`) and plan from its text; its acceptance criteria become the plans'. At step 4 the first task takes that number as its `issue`, in the manifest and on the plan's line `Issue: #<number>`, so that `sync` rewrites the issue from the plan and no second one appears. Then, where the issue carries `ready-for-dev`, drop it: `gh issue edit <number> --remove-label ready-for-dev`.
- **The fit check is a real gate, in both directions.** A feature over its limits ends the run with the limit it broke and the advice to run `/kordal-plan`; the owner alone may overrule that. A request that meets every QUICK condition, the checklist in step 1 of `${CLAUDE_SKILL_DIR}/../kordal-quick/SKILL.md`, and that the active-milestone rule under that checklist would not send back here, is offered `/kordal-quick` in one sentence, and the owner chooses.
- **Owner decisions**, with `AskUserQuestion`, only where that section asks for them: the sentence at step 1, when the request leaves the behaviour ambiguous or a clarification would change what is built; the plans at step 3, when the feature has more than one task or the fit is in doubt. Everything else is yours: a one-task feature whose request was unambiguous is planned without a question.
- Write the plans with `writing-for-agents`.
- Finish with the first task and the output of `next`, with the plan itself where the owner has not approved it, and say `/kordal-build` delivers it. A feature gets no summary page: generate and open none.

## Update a scaffolded project

When `$ARGUMENTS` is `update` or `upgrade`, bring the project's scaffold up to date instead of planning. The update changes the tooling every task runs on, so where it lands depends on what is in progress.

1. **Place.** Start from a clean tree and `git fetch`, then run `node scripts/agent-local.mjs phase`, the one test of "How work enters" in the project's `AGENTS.md`:
   - **`between`**, between milestones: work on the base branch.
   - **`delivering`**, during a milestone: deliver the update as a task. Add `<prefix>-<next number>: Update the agent scaffold` by "Add a task during delivery" of `docs/agents/workflow.md`, with "None: tooling only" as its Flow, claim it, commit its plan and the manifest on its branch, and do steps 3 to 7 there. Tasks already in progress keep the old tooling until they merge the integration branch, which `finish` asks of them.
   - **The helper's usage text**: the scaffold predates `phase` and `base`, and is the one this mode updates. Its base branch is `base_branch` of `docs/plans/backlog.json`, `main` without one. Place it by hand: between milestones when `next` lists no task, and `git log --oneline <base>..<integration>` prints nothing or the owner confirms that the integration branch's pull request is merged; during a milestone otherwise.
2. **Migrate the names**, between milestones only: a project that still has `"mvp"` in its manifest is updated after its milestone merges; say so and stop. Where `docs/plans/backlog.json` still has `"mvp"`, run `node ${CLAUDE_SKILL_DIR}/migrate.mjs` in the project root. It renames the manifest key, the integration branch, the `docs/product/mvp<N>*` documents with their links, and on GitHub the branch and the milestone; it commits nothing. Commit its changes as their own commit.
3. **Update.** Run `bash ${CLAUDE_SKILL_DIR}/bootstrap.sh --update`, on a clean tree. Per file it merges what the scaffold changed since the version the project records into the project's file, three ways: a file the scaffold did not change stays as the project has it. It reports every file it touched as `added`, `updated`, `merged`, `removed` or `kept`, or as a `CONFLICT`. Show the owner the report.
   - **No conflict**: it has recorded the new version.
   - **Conflicts**: resolve the reported files and no others. One that holds conflict markers keeps the project's own content and takes the scaffold's change; one that was left untouched is merged, deleted or kept as its report line says. Then run `bash ${CLAUDE_SKILL_DIR}/bootstrap.sh --stamp`.
   - **No recorded version**: the update says so and changes nothing. Run `bash ${CLAUDE_SKILL_DIR}/bootstrap.sh --diff` instead, which compares every file with the scaffold (`missing`, `differs`); apply each scaffold change to the project's file by hand, keeping the project's own content, copy the missing files, then `--stamp`.
4. **Check the hosted workflows** as step 5 of "Scaffold a new project" says, where that has not been done.
5. **Bring the open plans up to the template.** Every plan in `planned/` and `active/` gets each section the template now has and the plan lacks, written from the plan's own content: a Flow drawn from its acceptance criteria, not a placeholder. Completed plans stay as they are. Where the scope document lacks a section the planning workflow now asks for, add it with the owner.
6. **Decide the gates' stages.** `pr-check` now runs `MILESTONE_STAGES` only, a gate with an empty list fails, and `finish` demands a `pr-check` and a `premerge-check` of the task that completes the queue. Where the Makefile leaves `MILESTONE_STAGES` or `RESILIENCE_STAGES` empty, give the list its stages, each a `.PHONY` target with a recipe, or, on the owner's yes, the single word `none`. Done when neither list is empty.
7. **Check.** Run `node scripts/agent-summary.mjs`, `make agent-check` and `bash tests/integration/check-docs.sh`. Done when the last two pass. Open the summary page in the owner's browser and say that it shows each Flow as its Mermaid source, which GitHub draws in the plan's own file.
8. **Record.** During a milestone, commit on the task's branch and take the task through the workflow's gate, review and `finish`: the update is then on the integration branch, and reaches the base branch with the milestone. Between milestones, commit the update as its own commit on the base branch and run `node scripts/agent-local.mjs start`, which moves the still unclaimed integration branch forward to it; a branch that a squash or rebase merge left behind stays where it is, and `start` says so: the next milestone or feature names its own. With a `repository`, push the base branch and run `node scripts/agent-local.mjs publish`; done when `node scripts/agent-issues.mjs sync --check` passes.

## Run the stages as gates

Work one stage at a time, in order. A stage is closed when its "Done when" holds and you have told the owner so, quoting the evidence: the file written, the decision recorded, the check output. Open the next stage only then.

Start by placing the session: the `Planning status` line of `docs/product/milestone<N>-research.md` names the last closed stage. Resume at the next one, reusing every decision the conversation and the drafts already hold. Where the line is missing, place the session from `docs/product/` and `docs/plans/backlog.json` and write the line. Update it each time a stage closes.

## Owner gates

Three decisions belong to the owner. At each, present one recommendation with its tradeoffs, ask with `AskUserQuestion`, and keep independent research moving while the answer is pending.

| Stage | The owner decides |
| --- | --- |
| 2. Choose one user outcome | Target user, priority, and the outcome sentence |
| 3. Map the journey and agree scope | The prototype of a visible outcome, on its target devices; then the complete scope proposal: capabilities, exclusions, deferred prerequisites, test budget |
| 4. Resolve major uncertainties | A revised proposal, when a finding changes the agreed outcome or scope |

Everything else is yours to resolve: routine engineering choices, task splits, dependency order.

## Skills per stage

- **Stage 1, baseline**: `research`, for the survey of existing solutions, the full one or the delta as stage 1 says, and for other evidence that lives outside the repository. For the delta, give the skill the earlier research notes and only the questions they leave open: the new, the stale and the uncovered.
- **Stage 3, scope**: `grilling`, on the draft scope before it goes to the owner; `prototype`, when a journey question needs something to click, and always for an outcome the user sees: show it to the owner at real size on each target device, in the browser pane or on the device itself.
- **Stage 4, uncertainties**: `prototype` for a bounded question; `domain-modeling` for each Proposed ADR.
- **Stage 5, backlog**: `writing-for-agents`, since every task plan is read by the agent that implements it. Open the implementation summary in the owner's browser (`open docs/product/milestone<N>-summary.html`) and say what it shows in three lines.

Where a skill this file names is not installed, do its step yourself and tell the owner which one was missing.

## Planning stays beside delivery

Planning writes documents: the research note, the scope draft, Proposed ADRs, plans in `docs/plans/planned/`. The active milestone's queue, claims, branches and manifest change only at stage 6, after that queue is finished or the owner hands it off. There the integration branch is created and moved with `node scripts/agent-local.mjs start`, never by hand.

Finish with the stage 6 handoff: the first ready task, the remaining blockers with who resolves each, and the output of the three structure checks and `node scripts/agent-local.mjs next`. Delivery starts with `/kordal-build`.
