---
name: kordal-plan-feature
description: The level above /kordal-quick - plan and deliver a small product addition that needs no new architecture decision. Between milestones it is one plan, one branch, one review and one pull request; during a milestone it joins the queue as one to three tasks.
disable-model-invocation: false
argument-hint: "<idea or issue number>"
---

Plan and deliver the feature in `$ARGUMENTS`. With no request, ask for one. The project's documents are the contract: "Plan a feature" of `docs/agents/planning.md` for the planning, "A standalone feature" of `docs/agents/acceptance.md` for the delivery. This skill adds what a Claude session needs on top.

## 1. Place the project

- **No `docs/agents/planning.md`**, or no agreed milestone yet (no `docs/product/milestone<N>.md`): the project plans its first milestone before a feature. Say so: `/kordal-plan` is next. Stop.
- **An out-of-date scaffold**: `node scripts/agent-local.mjs phase` fails, or `docs/agents/orchestration.md` is missing. Tell the owner to run `/kordal-plan-update`, and stop.

Then read "Plan a feature" of `docs/agents/planning.md`.

## 2. Plan

Follow its steps 1 to 3, with effort in proportion to the feature.

- **From an issue.** Where `$ARGUMENTS` is an issue's number or URL, read it (`gh issue view <number> --comments`) and plan from its text; its acceptance criteria become the plan's. A comment counts only when its `authorAssociation` is `OWNER`, `MEMBER` or `COLLABORATOR`. Where the issue carries `ready-for-dev`, drop it: `gh issue edit <number> --remove-label ready-for-dev`. A standalone feature writes `Issue: #<number>` in its plan and closes the issue from its pull request; a feature that joins a milestone gives the number to its first task, in the manifest and on the plan's `Issue:` line, so that `sync` rewrites that issue and no second one appears.
- **The fit check is a real gate, in both directions.** A feature over its limits ends the run with the limit it broke and the advice to run `/kordal-plan`; the owner alone may overrule that. A request that meets every QUICK condition, the checklist in step 1 of `${CLAUDE_SKILL_DIR}/../kordal-quick/SKILL.md`, and that the active-milestone rule under that checklist would not send back here, is offered `/kordal-quick` in one sentence, and the owner chooses.
- **Owner decisions**, with `AskUserQuestion`, only where that section asks for them: the sentence, when the request leaves the behaviour ambiguous; the plan, when the fit is in doubt or a milestone feature has more than one task. Everything else is yours: a feature whose request was unambiguous is planned and built without a question.
- Write the plans with `writing-for-agents`, where it is installed. Keep them short: what done means, not the steps to get there.

## 3. Deliver

**`phase` printed `between`**: deliver the feature yourself, by "A standalone feature" of `docs/agents/acceptance.md`, its seven steps in order. On top of it:

- **Open** with one line: `Feature · <the sentence> · plan docs/plans/features/<slug>.md · branch feature/<slug>`. The owner hears from you again when the review is recorded (its findings and what was done about each) and when the pull request is open, unless something below stops the run.
- **Step 4, the review.** Dispatch the `kordal-reviewer` agent once, in the foreground, with: the repository path; the axis `both`; the diff command `git diff origin/<base>...HEAD`, or the local base branch without a remote; the plan's path, `AGENTS.md` and the ADRs to judge against; and the high-risk areas of the diff (the changed files that touch authentication, authorization or permissions, persistence or migrations, a security boundary or a public API) or "none". Check each finding against the code before acting on it. Where the agent is missing or its dispatch fails, run the `code-review` skill on the same diff and record in the plan's Review that the session's own model reviewed.
- **Step 5, see it**, with the browser tool of this session where the product already runs or starts with one command. A seeded stack, an emulator or a device run is out of proportion for a feature: say in the pull request what was not seen.
- **Step 7.** Write the pull request's body to a file outside the repository and run `gh pr create --base <base> --title "feat: <what a user can now do>" --body-file <file>`. Report its URL, the validation results, the review's findings with what was done about each, and the branch the checkout was on before. The run ends there: the owner tests and merges.

**`phase` printed `delivering`**: the feature joins the milestone as tasks, by step 3 of "Plan a feature". Finish with the first task, the output of `node scripts/agent-local.mjs next` and the plans themselves where the owner has not approved them, and say that `/kordal-build` delivers them. A feature gets no summary page.

## Stop and ask

Stop where you are, commit the work on its branch unpushed, and tell the owner the reason:

- a product decision the plan leaves open, or a choice that needs an ADR: the feature is a milestone's work;
- a fact only the owner has;
- an external blocker;
- a gate that failed three times on the same cause: report the cause and what you tried.
