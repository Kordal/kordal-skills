---
name: kordal-plan
description: Plan the next milestone through the six-stage planning workflow, or a small feature through its short path; in a new project, scaffold the agent structure first.
disable-model-invocation: true
model: claude-opus-5-5
effort: high
argument-hint: "[milestone number or outcome idea | feature <idea> | update]"
---

Plan the milestone named in `$ARGUMENTS`; with no argument, plan the one after the latest `docs/product/milestone<N>.md`, or Milestone 1 when none exists.

The project's `docs/agents/planning.md` is the single source of truth for the stages, their artifacts and their "Done when" criteria. This skill adds only how to run it in a Claude session. Where the file is missing, [scaffold the project](#scaffold-a-new-project) first. Then read it in full.

Planning runs on Opus 5.5 at high effort. The frontmatter pins that for the turn that invokes the skill only; planning continues over several turns. At the start of a later turn in which you are another model, tell the owner in one line to switch the session to Opus 5.5 at high effort, and continue.

## Scaffold a new project

The scaffold is the agent structure this workflow runs on: `AGENTS.md`, `CLAUDE.md`, `docs/agents/` (planning, delivery, role instructions), `docs/plans/` (manifest, template, `planned/`, `active/`, `completed/`), `docs/adr/`, `docs/evidence/`, `docs/product/vision.md`, the delivery scripts and the GitHub issue mirror with their tests, the gate runner, the documentation check, the Makefile gates and the hosted structure check.

1. Run `bash ${CLAUDE_SKILL_DIR}/bootstrap.sh` in the project root (`bootstrap.sh` sits beside this file). It initializes Git when needed, reports every file as `created` or `kept`, and records the scaffold version in `docs/agents/scaffold-version`.
2. Merge each `kept` file by hand with its counterpart in `${CLAUDE_SKILL_DIR}/scaffold/`: an existing Makefile gains the scaffold's variables and targets, an existing `AGENTS.md` gains its delivery-workflow section and repository map.
3. Run `make agent-check` and `bash tests/integration/check-docs.sh`. Done when both pass; then commit the scaffold on main as its own commit and show the owner the bootstrap report.
4. A project without an `origin` remote: ask the owner once, with `AskUserQuestion`, whether to create a private GitHub repository for it, recommending yes. On yes, run `gh repo create <folder name> --private --source . --remote origin --push`, set `"repository": "<owner>/<name>"` in `docs/plans/backlog.json` and commit. A project that already has a GitHub `origin` gets that `repository` without the question. On no, the manifest stays without `repository` and the project is delivered without GitHub.

The scaffold's placeholders are HTML comments naming the planning stage that fills them. Replace each comment at that stage, so `AGENTS.md` and `vision.md` carry no placeholder at the stage 6 handoff.

## Plan a feature

When `$ARGUMENTS` starts with `feature`, plan the rest of it by the "Plan a feature" section of `docs/agents/planning.md` instead of the six stages. A project that has no agreed milestone yet plans its first milestone instead: say so.

- The fit check is a real gate. A feature over its limits ends the run with the limit it broke and the advice to run `/kordal-plan`; the owner alone may overrule that.
- Two owner decisions, both with `AskUserQuestion`: the feature sentence at step 1, the plans at step 3. Everything else is yours.
- Write the plans with `writing-for-agents`.
- Finish with the first task and the output of `next`, and say `/kordal-build` delivers it.

## Update a scaffolded project

When `$ARGUMENTS` is `update`, bring the project's scaffold up to date instead of planning. The update changes the tooling every task runs on, so it belongs between two milestones.

1. **Place.** Work on main with a clean tree. Stop, and say what has to finish first, when `node scripts/agent-local.mjs next` lists a `CLAIMED` task or the integration branch holds work main lacks (`git merge-base --is-ancestor <integration branch> main` fails).
2. **Migrate the names.** Where `docs/plans/backlog.json` still has `"mvp"`, run `node ${CLAUDE_SKILL_DIR}/migrate.mjs` in the project root. It renames the manifest key, the integration branch, the `docs/product/mvp<N>*` documents with their links, and on GitHub the branch and the milestone; it commits nothing. Commit its changes as their own commit.
3. **Diff.** Run `bash ${CLAUDE_SKILL_DIR}/bootstrap.sh --diff`. It prints what changed in the scaffold since the version the project records, and every scaffold file the project lacks. A project with no recorded version gets a file-by-file comparison instead. Show the owner the list.
4. **Apply** each scaffold change to the project's file, keeping the project's own content; copy the missing files.
5. **Check.** Run `node scripts/agent-summary.mjs`, `make agent-check` and `bash tests/integration/check-docs.sh`. Done when the last two pass.
6. **Record.** Run `bash ${CLAUDE_SKILL_DIR}/bootstrap.sh --stamp`, commit the update as its own commit and move the integration branch to it with `git branch -f <integration branch> main`. With a `repository`, push main and run `node scripts/agent-local.mjs publish`; done when `node scripts/agent-issues.mjs sync --check` passes.

## Run the stages as gates

Work one stage at a time, in order. A stage is closed when its "Done when" holds and you have told the owner so, quoting the evidence: the file written, the decision recorded, the check output. Open the next stage only then.

Start by placing the session: the `Planning status` line of `docs/product/milestone<N>-research.md` names the last closed stage. Resume at the next one, reusing every decision the conversation and the drafts already hold. Where the line is missing, place the session from `docs/product/` and `docs/plans/backlog.json` and write the line. Update it each time a stage closes.

## Owner gates

Three decisions belong to the owner. At each, present one recommendation with its tradeoffs, ask with `AskUserQuestion`, and keep independent research moving while the answer is pending.

| Stage | The owner decides |
| --- | --- |
| 2. Choose one user outcome | Target user, priority, and the outcome sentence |
| 3. Map the journey and agree scope | The complete scope proposal: capabilities, exclusions, deferred prerequisites |
| 4. Resolve major uncertainties | A revised proposal, when a finding changes the agreed outcome or scope |

Everything else is yours to resolve: routine engineering choices, task splits, dependency order.

## Skills per stage

- **Stage 1, baseline**: `research`, for the survey of existing solutions and other evidence that lives outside the repository.
- **Stage 3, scope**: `grilling`, on the draft scope before it goes to the owner; `prototype`, when a journey question needs something to click.
- **Stage 4, uncertainties**: `prototype` for a bounded question; `domain-modeling` for each Proposed ADR.
- **Stage 5, backlog**: `writing-for-agents`, since every task plan is read by the agent that implements it. Open the implementation summary in the owner's browser (`open docs/product/milestone<N>-summary.html`) and say what it shows in three lines.

## Planning stays beside delivery

Planning writes documents: the research note, the scope draft, Proposed ADRs, plans in `docs/plans/planned/`. The active milestone's queue, claims, branches and manifest change only at stage 6, after that queue is finished or the owner hands it off.

Finish with the stage 6 handoff: the first ready task, the remaining blockers with who resolves each, and the output of the three structure checks and `node scripts/agent-local.mjs next`. Delivery starts with `/kordal-build`.
