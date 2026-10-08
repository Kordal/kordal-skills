---
name: kordal-plan
description: Plan the next milestone - a substantial outcome, several coordinated changes or a new architecture decision - through the six-stage planning workflow; in a new project, scaffold the agent structure first.
disable-model-invocation: false
argument-hint: "[milestone number or outcome idea | update]"
---

Plan what the project builds next. `$ARGUMENTS` picks the mode:

| `$ARGUMENTS` | Mode |
| --- | --- |
| empty | Plan the milestone after the latest `docs/product/milestone<N>.md`, or Milestone 1 when none exists |
| a milestone number or an outcome idea | Plan that milestone |
| `update` | [Update a scaffolded project](#update-a-scaffolded-project) |

The project's `docs/agents/planning.md` is the single source of truth for the stages, their artifacts and their "Done when" criteria. This skill adds only how to run it in a Claude session. Where the file is missing, [scaffold the project](#scaffold-a-new-project) first. Then read it, the whole file, for a milestone; an update does not read it.

A milestone is the top of the ladder QUICK → FEATURE → MILESTONE. An outcome idea that fits one plan and one pull request and needs no new architecture decision is offered `/kordal-plan-feature` before stage 1. One clear, localized, low-risk change is offered `/kordal-quick`, unless it touches a file an active milestone has changed: that one is a feature too.

The base branch, here as there, is the one `node scripts/agent-local.mjs base` prints. Where `base` or `phase` fails, the scaffold is out of date: a milestone is planned after `/kordal-plan-update`, so tell the owner, and stop. The update itself runs on the old helper, as its step 1 says.

## Scaffold a new project

The scaffold is the agent structure this workflow runs on: `AGENTS.md`, `CLAUDE.md`, `docs/agents/` (planning, task delivery, orchestration, acceptance), `docs/plans/` (manifest, template, `planned/`, `active/`, `completed/`, `features/`), `docs/adr/`, `docs/DECISIONS.md`, `docs/product/vision.md`, the delivery scripts and the GitHub issue mirror with their tests, the gate runner, the documentation check, the Makefile gates and the hosted structure check.

1. Run `bash ${CLAUDE_SKILL_DIR}/bootstrap.sh` in the project root (`bootstrap.sh` sits beside this file). It initializes Git when needed, reports every file as `created` or `kept`, detects the base branch and records one other than `main` as `base_branch` in the manifest it created (the report line `base`), and records the scaffold version in `docs/agents/scaffold-version`.
2. Merge each `kept` file by hand with its counterpart in `${CLAUDE_SKILL_DIR}/scaffold/`: an existing Makefile gains the scaffold's variables and targets, an existing `AGENTS.md` gains its routing table, its delivery-workflow section and its repository map. Do what a `WARN` line of the report asks, such as adding `base_branch` to a manifest that was kept.
3. Run `make agent-check` and `bash tests/integration/check-docs.sh`. Done when both pass; then commit the scaffold on the base branch as its own commit and show the owner the bootstrap report.
4. **GitHub.** A project without an `origin` remote: ask the owner once, with `AskUserQuestion`, whether to create a private GitHub repository for it, recommending yes, since every command ends at a pull request. On yes, run `gh repo create <folder name> --private --source . --remote origin --push`. A project with a GitHub `origin` gets `"repository": "<owner>/<name>"` in `docs/plans/backlog.json`: the integration branch is pushed there and the milestone's pull request opened from it. Then ask once whether to mirror the tasks as GitHub issues too, recommending no unless other people follow the work on GitHub: the repository is the source of truth either way, and issues cost a round of GitHub calls at every claim and integration. On no, add `"issues": false` to the manifest. Commit the manifest. On no `origin` at all, it stays without `repository` and the project is delivered without GitHub.
5. A project with hosted workflows that run on a push to the base branch (`.github/workflows/*.yml` with `on: push`): planning pushes the base branch with documents only, and a path filter that ignores `**.md` alone still fires on `docs/plans/backlog.json` and the summary page. Show the owner each such workflow and add `docs/**` and `scripts/agent-*` to its `paths-ignore` on their yes, so that the base branch builds and publishes only when product code reaches it: at the milestone's merge.

The scaffold's placeholders are HTML comments naming the planning stage that fills them. Replace each comment at that stage, so `AGENTS.md` and `vision.md` carry no placeholder at the stage 6 handoff.

## Update a scaffolded project

When `$ARGUMENTS` is `update` or `upgrade`, bring the project's scaffold up to date instead of planning. The update changes the tooling every task runs on, so where it lands depends on what is in progress.

1. **Place.** Start from a clean tree and `git fetch`. A manifest whose `integration_branch` is `feature/<slug>` with work still in it is a feature planned the old way, as tasks on their own integration branch, which this scaffold no longer delivers: tell the owner to ship it first with the skills checkout it was planned with (`git checkout` of an older commit there), and stop. Then run `node scripts/agent-local.mjs phase`, the one test of "How work enters" in the project's `AGENTS.md`:
   - **`between`**, between milestones: work on the base branch.
   - **`delivering`**, during a milestone: deliver the update as a task. Add `<prefix>-<next number>: Update the agent scaffold` by "Add a task during delivery" of `docs/agents/workflow.md`, with no Flow, claim it, commit its plan and the manifest on its branch, and do steps 3 to 7 there. Tasks already in progress keep the old tooling until they merge the integration branch, which `finish` asks of them.
   - **The helper's usage text**: the scaffold predates `phase` and `base`, and is the one this mode updates. Its base branch is `base_branch` of `docs/plans/backlog.json`, `main` without one. Place it by hand: between milestones when `next` lists no task, and `git log --oneline <base>..<integration>` prints nothing or the owner confirms that the integration branch's pull request is merged; during a milestone otherwise.
2. **Migrate the names**, between milestones only: a project that still has `"mvp"` in its manifest is updated after its milestone merges; say so and stop. Where `docs/plans/backlog.json` still has `"mvp"`, run `node ${CLAUDE_SKILL_DIR}/migrate.mjs` in the project root. It renames the manifest key, the integration branch, the `docs/product/mvp<N>*` documents with their links, and on GitHub the branch and the milestone; it commits nothing. Commit its changes as their own commit.
3. **Update.** Run `bash ${CLAUDE_SKILL_DIR}/bootstrap.sh --update`, on a clean tree. Per file it merges what the scaffold changed since the version the project records into the project's file, three ways: a file the scaffold did not change stays as the project has it. It reports every file it touched as `added`, `updated`, `merged`, `removed` or `kept`, or as a `CONFLICT`. Show the owner the report, and do what a `WARN` line asks, such as adding `base_branch` to the manifest.
   - **No conflict**: it has recorded the new version.
   - **Conflicts**: resolve the reported files and no others. One that holds conflict markers keeps the project's own content and takes the scaffold's change; one that was left untouched (a file of the project's own, one behind a symbolic link, one Git does not track) is merged, deleted or kept as its report line says. Then run `bash ${CLAUDE_SKILL_DIR}/bootstrap.sh --stamp`, and not `--update` a second time, which merges from the old version again.
   - **A refusal** changes nothing and says what it needs: a clean tree; or a skills checkout that contains the recorded version (`git pull` there, then `--update` again).
   - **No recorded version**: the update says so and changes nothing. Run `bash ${CLAUDE_SKILL_DIR}/bootstrap.sh --diff` instead, which compares every file with the scaffold (`missing`, `differs`); apply each scaffold change to the project's file by hand, keeping the project's own content, copy the missing files, then `--stamp`.
4. **Check the hosted workflows** as step 5 of "Scaffold a new project" says, where that has not been done.
5. **Bring the open plans up to the template.** Every plan in `planned/` and `active/` gets each section the template now has and the plan lacks, written from the plan's own content, never a placeholder; a section the template dropped may stay. Completed plans stay as they are. Where the scope document lacks a section the planning workflow now asks for, add it with the owner.
6. **Decide the gates' stages.** `pr-check` now runs `MILESTONE_STAGES` only, a gate with an empty list fails, and `finish` demands a `pr-check` and a `premerge-check` of the task that completes the queue. Where the Makefile leaves `MILESTONE_STAGES` or `RESILIENCE_STAGES` empty, give the list its stages, each a `.PHONY` target with a recipe, or, on the owner's yes, the single word `none`. Done when neither list is empty.
7. **Check.** Run `node scripts/agent-summary.mjs`, `make agent-check` and `bash tests/integration/check-docs.sh`. Done when the last two pass. Open the summary page in the owner's browser and say that it shows each Flow as its Mermaid source, which GitHub draws in the plan's own file.
8. **Record.** During a milestone, commit on the task's branch and take the task through the workflow's gate, review and `finish`: the update is then on the integration branch, and reaches the base branch with the milestone. Between milestones, commit the update as its own commit on the base branch and run `node scripts/agent-local.mjs start`, which moves the still unclaimed integration branch forward to it; a branch that a squash or rebase merge left behind stays where it is, and `start` says so: the next milestone names its own. With a `repository`, push the base branch and run `node scripts/agent-local.mjs publish`; done when `node scripts/agent-issues.mjs sync --check` passes.

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
