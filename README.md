# kordal-skills

[Claude Code](https://claude.com/claude-code) skills that plan and deliver a product with agents. Work enters on one ladder, QUICK → FEATURE → MILESTONE: `/kordal-quick` makes one clear, low-risk change directly, `/kordal-plan-feature` plans a small addition, `/kordal-plan` plans a milestone. `/kordal-build` delivers what was planned, and `/kordal-improve` finds what is worth improving. Three agents do the delivery, review and investigation work the skills dispatch. In a milestone the repository of the project is the source of truth and GitHub issues mirror it.

Two tracks stand beside the ladder. `/kordal-bug` takes a bug [from its report to a fix](#fixing-a-bug). The issue workflow, `/kordal-issue`, `/kordal-issue-review` and `/kordal-issue-code`, takes one change [from an issue to a pull request](#from-an-issue-to-a-pull-request), and only where you ask for an issue, hand the work off for later, or manage the repository through reviewed issues.

## Install

```bash
git clone https://github.com/Kordal/kordal-skills.git ~/Development/kordal-skills
mkdir -p ~/.claude/skills ~/.claude/agents
for skill in ~/Development/kordal-skills/kordal-*/; do ln -sfn "${skill%/}" ~/.claude/skills/; done
for agent in ~/Development/kordal-skills/agents/*.md; do ln -sfn "$agent" ~/.claude/agents/; done
```

Any folder works in place of `~/Development/kordal-skills`. A pull that removes an agent or a skill leaves its link dangling: `find ~/.claude/skills ~/.claude/agents -maxdepth 1 -xtype l -delete` clears them. Finish a feature planned the old way, as tasks on a `feature/<slug>` integration branch, before pulling a version where features are one plan and one pull request. The two loops link every `kordal-*/` directory and every agent, so a `git pull` there updates them all; after a pull that adds a skill or an agent, run the loops again. The skills load in Claude Code sessions started after the install.

A pull updates the skills, not the projects: each project keeps the scaffold it was created with. After a pull that changes `kordal-plan/scaffold/`, run `/kordal-plan-update` in each scaffolded project before `/kordal-build`. A skill that needs a newer scaffold than the project has says so and stops.

Needs:

- Claude Code;
- `git`, 2.38 or newer for parallel rounds, which merge without a checkout;
- `bash`, `make` and `node` 20 or newer (CI runs 24);
- `gh`, logged in, for the GitHub mirror, the issue commands and every pull request a command opens.

The skills also call seven skills this repository does not ship. Planning uses `research`, `grilling`, `prototype`, `domain-modeling` and `writing-for-agents`; `/kordal-bug` follows `diagnosing-bugs`; `code-review` takes the place of a reviewer agent that is missing. Where a planning skill or `diagnosing-bugs` is missing, Claude does that step itself and says which skill it lacked.

Every skill and agent runs on the model you choose for the session; none of them sets a model or an effort level. To pin one, add `model:` and `effort:` to the frontmatter of a skill or an agent.

`/kordal-plan-update`, `/kordal-build-all`, `/kordal-build-serial` and `/kordal-build-ship` are commands of their own that run the matching mode of `/kordal-plan` or `/kordal-build`.

## Which command

| Level | Command | Use when |
| --- | --- | --- |
| QUICK | `/kordal-quick <request>` | One clear, localized, low-risk change that follows an existing pattern. Ends at a pull request. No plan, task or issue |
| FEATURE | `/kordal-plan-feature <idea>` | A small planned product addition, no new architecture decision: one plan, one branch, one review, one pull request; during a milestone, one to three of its tasks. Also whatever fails a QUICK condition but fits these limits |
| MILESTONE | `/kordal-plan` | A substantial outcome: several coordinated changes, more than three tasks, or a new architecture decision |
| BUG | `/kordal-bug <report>` | Behaviour that departs from what the product already promises |
| ISSUE | `/kordal-issue` → `/kordal-issue-review` → `/kordal-issue-code` | Only when the owner asks for an issue, wants the work handed off for later, or the repository is managed through reviewed GitHub issues. Never chosen for a direct request to build something |
| QUESTION | `/kordal-improve <question>` | "What should we improve?": findings and proposals, no code |

QUICK → FEATURE → MILESTONE is one ladder: each level takes what the level below must refuse.

During an active milestone (`node scripts/agent-local.mjs phase` prints `delivering` and the reason: a task of the manifest is unfinished, or the integration branch holds work the base branch lacks): a QUICK change that touches no file the milestone has changed (`git diff --name-only <base>...<integration>`) is still QUICK, from the base branch; anything else joins the milestone: a feature through `/kordal-plan-feature` (its tasks join the queue), a bug through `/kordal-bug` (it becomes a task), a reviewed issue through `/kordal-plan-feature <number>`. Larger work waits for the next milestone's planning. The command prints `between` otherwise; it decides by merging, not by ancestry, so a squash- or rebase-merged pull request counts as merged. A repository without the scaffold has no milestone.

A scaffolded project holds the same table in its `AGENTS.md`, under "How work enters", so that every agent routes a request the same way.

## Commands

| Command | Does |
| --- | --- |
| `/kordal-quick <request>` | Makes one clear, localized, low-risk change directly: a branch from the base branch, the smallest change, targeted validation, a pull request. Creates no plan, task or issue, and escalates whatever turns out risky or unclear. Never merges |
| `/kordal-plan` | Plans the next milestone. In a new folder it scaffolds the project first. Resumes interrupted planning |
| `/kordal-plan <idea>` | The same, starting from the idea |
| `/kordal-plan-feature <idea or issue number>` | Plans and delivers a small addition with no new architecture decision: one plan, one branch, one review, one pull request. During a milestone it joins the queue as one to three tasks instead. Given an issue, plans from its text and closes it from the pull request, or makes it the first task's issue |
| `/kordal-plan-update` | Brings a project's scaffold up to date with this repository: a three-way merge per file, which keeps what the project changed. Has you decide the stages of the full and the resilience gate where the Makefile leaves them empty |
| `/kordal-improve <question>` | Investigates a question about the product or its code; returns evidenced findings and ranked proposals. Changes no code |
| `/kordal-issue <description>` | Writes a GitHub issue a coding agent can implement, when you ask for an issue or hand the work off for later: inspects the repository, writes testable acceptance criteria, creates the issue labelled `needs-review`. A direct request to build something is sent to its level instead |
| `/kordal-issue-review <issue>` | Reviews an issue against the repository before development, in a context that did not write it: one result (`READY`, `NEEDS_REWORK`, `NEEDS_INFO`, `TOO_LARGE`, `DUPLICATE`), posted as one comment, and the matching label. Only `READY` sets `ready-for-dev`. Changes no code |
| `/kordal-issue-code <issue>` | Implements an issue labelled `ready-for-dev`: branch, the smallest change that meets every acceptance criterion, tests, validation in proportion to the change, self-review, and a pull request labelled `needs-pr-review`. Escalates a product decision to the issue (`needs-info`) instead of guessing. Never approves or merges |
| `/kordal-bug <what is wrong, or an issue number>` | Fixes a bug: reproduces it, finds the cause, fixes it under a regression test, and opens a pull request labelled `needs-pr-review`. During a milestone the fix is delivered as a task instead. Names the level for what turns out to be a feature, sends a fix that needs an architecture decision to `/kordal-plan`, and a product decision or a fix that needs several changes to `/kordal-issue`. Never approves or merges |
| `/kordal-build` | Delivers the next ready task, or resumes the unfinished one |
| `/kordal-build <ID>` | Delivers that task |
| `/kordal-build-all` | Delivers the whole queue in rounds: up to five independent tasks side by side, each in its own worktree, integrated together |
| `/kordal-build-serial` | The same, one task at a time |
| `/kordal-build-ship` | Opens the pull request of the accepted milestone, then stops the dev servers, emulators and containers the milestone started. The owner merges |

Claude may start a command itself when the conversation calls for it. The milestone's pull request is opened only on your typed command: Claude cannot start `/kordal-build-ship`, and the `ship` mode of `/kordal-build` opens nothing unless you typed it.

## Agents

The skills dispatch these; you do not call them yourself.

| Agent | Dispatched by | Does |
| --- | --- | --- |
| `kordal-builder` | `/kordal-build-all`, `/kordal-build-serial` | Delivers one task: on its own from claim to report, or as one task of a parallel round up to its completed plan, which the session then integrates |
| `kordal-reviewer` | `/kordal-build`, `/kordal-plan-feature`, `kordal-builder` | Reviews a diff on the axis it is given: both axes in one pass for a risky task or a feature; one axis each, two side by side, for the milestone. Read-only |
| `kordal-investigator` | `/kordal-improve` | Reads the code and searches how others solve the question. Read-only |

The builder is self-contained: it reads the task's plan, the ADRs the manifest lists for it and `docs/agents/workflow.md`, the one contract for delivering a task, and no skill file; the orchestration, acceptance and planning documents serve other sessions. A reviewer reads in proportion to the changed surface: the diff, the unit around each hunk, and the callers and callees its behaviour depends on. It reads a file whole, and traces its callers, only where the change touches authentication, authorization, persistence or migrations, a security boundary or a public API.

## Planning a milestone

Six stages; a stage closes only with evidence. The owner decides at the stages in bold.

| # | Stage | Output |
| --- | --- | --- |
| 1 | Baseline: what exists, what users need, what existing solutions do better | `docs/product/vision.md`, `milestone<N>-research.md` |
| 2 | **One user outcome**: "A [user] can [job], demonstrated by [result]" | `docs/product/milestone<N>.md` |
| 3 | **Journey and scope**: capabilities, exclusions, acceptance scenarios, test budget; a prototype at real size for anything the user sees | `milestone<N>.md` completed |
| 4 | Uncertainties: research, prototypes, architecture decisions (**only if a finding changes the scope**) | Proposed ADRs in `docs/adr/` |
| 5 | Backlog: few, large tasks (about an hour of work at least), cut along components; one short plan per task with acceptance criteria, and a flow diagram where it has a user journey | `docs/plans/planned/`, `backlog.json`, `milestone<N>-summary.html` |
| 6 | Handoff: issues created, integration branch `milestone<N>` created with `node scripts/agent-local.mjs start`, structure checks | First ready task |

Stage 1 researches the delta. The first milestone, and one that takes the product in a new direction, get the full survey of existing solutions, with a web search. Every other milestone reads the earlier research notes and the improvement reports first, reuses the findings that still hold, and searches only for a new question, stale evidence (older than about six months, or known to have changed), a product area not covered before, or a meaningful development. The note records what was reused, with the note and the date it comes from, and what was refreshed or added, with the date and the reason.

`milestone<N>-summary.html` is a generated page for the owner: the scope, the tasks in layers by dependency, every task with its criteria and flow, and the decisions. It is static HTML and CSS: no script, and nothing loaded from another address, so it opens without a connection. A flow is shown as its Mermaid source, which GitHub draws in the plan's own file.

## Planning a feature

`/kordal-plan-feature <idea>` is the level above QUICK, with effort in proportion to the feature:

- it states the feature as one sentence, and asks you to confirm it only where the request leaves the behaviour open;
- it checks the fit (one plan and one pull request, no new ADR, not excluded), and offers `/kordal-quick` for a request that meets every QUICK condition and touches no file an active milestone has changed;
- between milestones it writes **one** plan, `docs/plans/features/<slug>.md`, and delivers it itself: a `feature/<slug>` branch from the base branch, the code and its tests, `make task-check`, one review of the whole diff by `kordal-reviewer`, one look at the running change, and one pull request that you test and merge. No backlog task, integration branch, GitHub issue or test document; it asks for your approval only when the fit is in doubt or the request was ambiguous;
- during a milestone it writes one to three task plans instead, registers them in the queue, and `/kordal-build` delivers them;
- it generates no summary page: that is a milestone's artifact.

## A quick change

`/kordal-quick Rename the "Save" button of the profile form to "Save changes"`: one branch, the commits of one change, one pull request, and a stop for you. It needs no scaffold: any Git repository with a GitHub `origin` will do.

Every condition must hold. One that fails, or that cannot be ticked with certainty, escalates; a request is never stretched to fit:

- one coherent, localized change; the requirement is already clear; it follows an existing implementation pattern;
- no new architecture decision or ADR; no database or schema migration; no new production dependency;
- no authentication, authorization or permission change; no change to how sensitive data is handled;
- no infrastructure, deployment or CI change; no public API or durable contract change; no destructive operation;
- no uncertainty that materially changes product behaviour.

| # | Step | Ends when |
| --- | --- | --- |
| 1 | Qualify: each condition ticked against the request | All hold, or the run has ended with the failed one named |
| 2 | Inspect: the code the change touches, the pattern it follows, the tests of both | The files, the pattern and the proving test are named |
| 3 | Branch: `quick/<short-description>` from the fetched base branch, in a worktree of its own: your checkout stays as it is | The worktree is on it |
| 4 | Change: the smallest one that satisfies the request | Every changed line serves it |
| 5 | Validate: the tests of the changed area; lint, format and type check of the changed files | Each command has its result as it ran; a check that was not run is recorded as not run |
| 6 | Review the diff: read whole, once | It holds the change and nothing else; then it is committed |
| 7 | See it: one look at a visible change, the cheapest way that shows it, never a full acceptance environment | It was seen, or the pull request says why not |
| 8 | Pull request to the base branch | It is open |
| 9 | Stop | You have its URL and the worktree to remove after the merge; review and merge are yours |

It creates no milestone, backlog task, GitHub issue, task plan, Mermaid flow, summary page, integration branch or approval gate, and it merges nothing. It uses neither the gate helper nor a reviewer agent: its proof is the targeted validation and its own reading of the diff, and its review is yours, on the pull request.

Where the work or the diff reveals elevated risk, it stops at once, commits what it has on its `quick/` branch, unpushed and without a pull request, and names the next level: `/kordal-plan-feature`, `/kordal-plan`, or `/kordal-issue` in a repository without the scaffold. [Which command](#which-command) says what stays QUICK while a milestone is being delivered.

## Asking an improvement question

`/kordal-improve Check if we can make the chat experience more human-like`: Claude turns the question into checkable criteria you confirm, uses the running product, and has a separate agent read the code and search how others solve it. You get findings with evidence and at most seven ranked proposals, and give each a verdict: now, later or no. The report is saved under `docs/product/improvements/`. A "now" that fits a feature continues with `/kordal-plan-feature`; one that needs a milestone or an architecture decision waits for `/kordal-plan`, whose baseline reads the report.

## From an issue to a pull request

Use it only when you ask for an issue, want the work handed off for later, or manage the repository through reviewed GitHub issues. A direct request to build something goes to `/kordal-quick`, `/kordal-plan-feature` or `/kordal-plan`.

`/kordal-issue` writes the issue, `/kordal-issue-review` judges it against the repository, `/kordal-issue-code` implements it and opens the pull request. Your checkpoint is that pull request; you merge it.

An issue carries one state label at a time. `kordal-issue/labels.sh` makes sure the repository has all eight before the first one is set: one `gh label list`, then a `gh label create` for each label that is missing. `/kordal-issue`, `/kordal-issue-review`, `/kordal-issue-code` and `/kordal-bug` run it, so that no later command, such as `gh pr create --label needs-pr-review`, meets a label that does not exist.

| Label | Set by | Means |
| --- | --- | --- |
| `needs-review` | `/kordal-issue` | Written, not yet judged |
| `needs-rework` | `/kordal-issue-review` | The text has to change, or the issue has to be split |
| `needs-info` | `/kordal-issue-review`, `/kordal-issue-code` | A product decision is missing; answer it on the issue |
| `duplicate`, `already-implemented` | `/kordal-issue-review` | Another issue holds the work, or the code already does it |
| `ready-for-dev` | `/kordal-issue-review` alone | A coding agent can implement it as it stands |
| `in-development` | `/kordal-issue-code`, `/kordal-bug` | Being implemented on its branch |
| `needs-pr-review` | `/kordal-issue-code`, `/kordal-bug` | The pull request is open |

The effort follows the issue:

- **Review.** The issue is the map, and the review checks the map: it verifies the material claims, those an acceptance criterion or the implementation rests on, and runs five bounded checks, inside the area the issue names, for what the issue did not say. With no issue named, it lists those labelled `needs-review`, and separately those waiting on their author or on you: `needs-rework` and `needs-info`.
- **Implementation.** `/kordal-issue-code` uses the reviewed Repository Context as its map: it opens the paths named there, verifies the claims it relies on, and searches wider only where a claim fails or the context is silent.
- **Validation.** Targeted checks first: the tests of the changed area, and lint, format and type check of the changed files. Then the checks the project requires for the affected area. Broader suites, the build and end-to-end tests run when the risk, the repository's policy or the affected scope calls for them. A check that was not run is reported as not run.

`/kordal-issue-code` starts only on a `READY` review that is newer than the last edit of the issue's text, and counts only comments by the repository's owner, members and collaborators. An interrupted run, or one that stopped on a question, resumes on its pushed branch.

A project that is delivering a milestone takes no pull request per issue: there the issue joins the milestone with `/kordal-plan-feature <issue number>`, which makes it the first task's issue.

## Fixing a bug

`/kordal-bug The export button downloads an empty file`, or `/kordal-bug 87` for a bug that already has its issue. A bug is behaviour that departs from what the product already promises, so it skips the issue review: its reproduction, turned green, is what done means.

| # | Step | Ends when |
| --- | --- | --- |
| 1 | Understand: the report as one sentence that names the promise it breaks | The checkout is on the current target |
| 2 | Reproduce: one command that goes red on the symptom | It failed the way you described. A bug that stays green ends the run: no fix on a guess |
| 3 | Cause: the wrong line, proven with a prediction | The cause explains every observation |
| 4 | Route: a cause outside the repository, a feature, a product decision or a large fix leaves here | The fix is one change |
| 5 | Fix: the regression test first, then the smallest change at the cause | The test is green and was red before |
| 6 | Pull request: Bug, Cause, Fix, Regression test, Validation | It is open; you merge it |

Step 4 names the level for what turns out to be a feature, sends a fix that needs an architecture decision to `/kordal-plan`, and a product decision or a fix that needs several changes to `/kordal-issue`. While a milestone is being delivered, it turns the fix into a task of that milestone and `/kordal-build` delivers it. Review comments on the pull request are addressed with `/kordal-bug <pull request number>`.

## Delivering

Per task: claim, implement, gate, review, complete, integrate, report. In the project, `docs/agents/workflow.md` is the one contract for it, whoever delivers the task; `docs/agents/orchestration.md` holds the gates in full, parallel rounds, the GitHub mirror and timings, for the session that runs the queue.

| Gate | Runs | When |
| --- | --- | --- |
| `make task-check`, the task gate | `TASK_STAGES`: lint, the structure check (`make structure-check`) and the fast product tests | Every task that changes a runtime file, before it is integrated |
| `make pr-check`, the full gate | `MILESTONE_STAGES` only, the slow suites. The task gate is not repeated: the helper makes sure one covers the commit, and runs it first when none does | Once, by the task that completes the queue |
| `make premerge-check`, the resilience gate | `RESILIENCE_STAGES`: operations, backup and restore, upgrade, the release build | Once, with the full gate |
| `make agent-check` | The structure check and the agent tooling's own tests. No stage of a task | With the task gate of a branch that changes the agent tooling; in the hosted check of the pull request, beside the documentation check; by hand after a scaffold update |

- **Gate.** `node scripts/agent-local.mjs gate` runs a gate on a committed, clean tree and records the result for the commit. A failed gate records nothing, and integration checks the record.
- **Reuse.** A recorded gate covers every later commit until a runtime file changes: `gate` then runs nothing and says `reused`, and `--force` runs it anyway. The review, the plan's notes and the owner's test document, committed after a gate, keep its result.
- **Documentation.** It needs no gate and keeps a recorded one, so it is checked where it is integrated: `finish` and `integrate` run the documentation check on the commit they integrate, unless a task gate on that very commit ran it, and move nothing while a link is broken.
- **The end of the queue is enforced.** `finish` refuses the task that completes the queue unless a `pr-check` and a `premerge-check` cover its commit, and while the base branch has commits its branch lacks: the local one, or `origin`'s as last fetched.
- **Stages.** A stage is a `.PHONY` make target with a recipe: a gate refuses one that make has nothing to run for, and a gate without stages fails. The single word `none`, as in `RESILIENCE_STAGES := none`, declares the full or the resilience gate not applicable to the product: it passes, and is recorded and reported as such. The task gate cannot be declared `none`.
- **Review, in proportion to the risk.** A task whose diff touches authentication, authorization, persistence or migrations, a security boundary or a public API, accepts an ADR, or changes more than 300 lines is reviewed on both axes, Standards and Spec, in one pass by the `kordal-reviewer` agent, in a context that has not seen the implementation, read-only. Any other task records the deliverer's own second reading as `Self-reviewed: low risk`, with the reason. The milestone review reads every task's change again, with two reviewers, one per axis. Recorded in the plan; an unreviewed task cannot be finished.
- **No slow testing per task.** A task runs lint, the structure check and unit tests only. Browser, device and end-to-end tests are written in the task and run once, at the end.
- **Parallel rounds.** `/kordal-build-all` delivers `READY` tasks that touch different files side by side, up to five in a round. One `claim` starts every branch from the same revision; each task gets a worktree and a `kordal-builder`, which stops once its completed plan is committed; one `integrate` then takes the round, all or nothing. It makes the checks of `finish` for every task, merges the branches without touching a checkout, runs one combined task gate on the assembled commit when more than one task changed runtime files, and advances the integration branch in one step. A conflict or a failed combined gate moves nothing: that round's tasks are finished one at a time. The task that completes the queue is never part of a round.
- **Updates.** You hear of a task at its three phase boundaries: started; implemented and gated, with the review's findings; integrated, with the report. Each part of the acceptance task, the first look and a blocker get an update of their own. A mechanical step, such as a branch switched, a plan moved or a merge, gets none.
- **Report.** What was added, what was verified, how to try it, what is next; also posted on the task's issue.
- **First look.** The first task that changes what a user sees ends with a stop: the owner looks at the running product on the target devices before the rest is built on it.
- **Budget.** The scope names the test data size and how long the gates may take; `gate` reports its duration and says when it went over.
- **Timings.** The helper logs every claim, gate, integration and publication in the Git directory: local, never pushed. `node scripts/agent-local.mjs timings` prints where the time went: per task from claim to integration, with its implementation, its task gates and its review and completion; then the combined gates of the rounds, the full and the resilience gate with their stages, and GitHub publication.

A milestone ends with its acceptance task, which `docs/agents/acceptance.md` holds: the full check (both gates, then a walk through every task's flow on each target device), a review of the whole milestone, whose high and medium findings block acceptance, then a test list for the owner in `docs/product/milestone<N>-test.md`. Each failure the owner reports becomes a task. Only after the owner accepts does `/kordal-build-ship` open the pull request. It fetches first, and stops where the base branch on `origin` holds commits the milestone lacks, such as a quick change merged since the acceptance: you accept that GitHub merges them with the milestone, a combination nothing tested, or a task brings them in and you repeat the acceptance for what changed.

## GitHub

A project with a GitHub `origin` names it as `"repository"` in the manifest: the integration branch is pushed there and the milestone's pull request opened from it. Issues are optional, asked once when the project is scaffolded, recommending no unless other people follow the work on GitHub; `"issues": false` in the manifest turns them off, and removing that line between milestones, then running `node scripts/agent-local.mjs publish`, turns them on. With issues:

- one issue per task in the GitHub milestone `Milestone <N>`, generated from the plan;
- one status label per issue: `waiting`, `blocked`, `ready`, `in-progress`, `done`;
- an issue closes when its task is integrated.

The updates are targeted. `claim`, `finish` and `integrate` each update GitHub once per command, so a round of five tasks updates it twice, at its claim and at its integration. They push the integration branch, and skip the push only when `origin`'s branch, as last fetched, already equals the local tip. They reconcile only the issues they affect, those of the tasks they name and of the tasks that depend on them directly, with one read and at most one write per issue: its state, status label, body and title. An issue that is in no GitHub milestone yet, one you wrote and a feature adopted, makes the update a full one. A task that has no issue yet gets one when it is claimed, on its own: a claim of several tasks refuses it, and its number is committed on its branch. `--no-publish` defers the update.

`node scripts/agent-local.mjs publish` is the full one: it pushes, and reconciles the labels, the GitHub milestone and every issue. `node scripts/agent-issues.mjs sync --check` changes nothing and fails on any difference.

When GitHub cannot be reached, or the update was deferred, the local result stands, and `next` reports that GitHub is out of sync until `publish` succeeds.

The base branch receives one pull request per milestone, and one per standalone feature. A push of the integration branch starts no hosted check. A clone that lacks the integration branch takes it from `origin`: `node scripts/agent-local.mjs start`.

## The base branch

The branch a milestone starts from and its pull request returns to: `main`, unless the manifest, `docs/plans/backlog.json`, names another as `"base_branch"`. `node scripts/agent-local.mjs base` prints it, and every document and skill asks there instead of assuming `main`.

`bootstrap.sh` detects it when it scaffolds a project: `origin/HEAD` where the repository has one; else `main`, then `master`, where that branch exists; else the branch the checkout is on. A repository it had to create is on `main`. It records a base branch other than `main` in the manifest it created.

The name is the repository's own (`master`, `trunk`, `release-1.x`) and differs from the integration branch. A repository without the scaffold uses its default branch.

## What a project gets

`kordal-plan/scaffold/` is copied into a new project once; after that the files belong to the project.

| Path | Contents |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md` | Instructions for every agent: rules, communication style, how work enters, which document to read when. `CLAUDE.md` only points to `AGENTS.md` |
| `docs/agents/` | `workflow.md`, the one contract for delivering a task; `orchestration.md`, the gates, parallel rounds, the GitHub mirror and timings; `acceptance.md`, the acceptance task, a standalone feature and the pull request; `planning.md`, the six stages and the feature path |
| `docs/product/` | Vision, scope, research, summary page, test lists |
| `docs/adr/` | Architecture Decision Records |
| `docs/DECISIONS.md` | One dated line per small, non-obvious choice that is not architecture |
| `docs/plans/` | `backlog.json`, the plan template, task plans in `planned/`, `active/`, `completed/`, standalone feature plans in `features/` |
| `scripts/agent-local.mjs` | The queue, the gates and the integration: `next`, `base`, `phase`, `start`, `claim`, `gate`, `finish`, `integrate`, `publish`, `timings` |
| `scripts/agent-workflow.mjs` | The structure check: the backlog against its plans and ADRs |
| `scripts/agent-issues.mjs` | The GitHub mirror: `sync`, `sync --check`, `comment` |
| `scripts/agent-summary.mjs` | Generates the summary page |
| `scripts/agent-scope.mjs`, `scripts/gate.sh` | Which files are runtime and which are agent tooling; the gate runner |
| `scripts/*.test.mjs`, `scripts/agent-issues.fake-gh.mjs` | The tooling's own tests, and the fake `gh` the mirror is tested against |
| `tests/integration/check-docs.sh` | Checks Markdown links, anchors and references |
| `Makefile` | `lint`, `test`, `structure-check`, `agent-check`, `task-check`, `pr-check`, `premerge-check` |
| `.github/` | The hosted check `Agent structure`, which runs `make agent-check` and the documentation check on a pull request; the pull request template |
| `.gitignore` | Environment files, dependencies, build output |

A new project has no product checks: `make test` fails until the first task adds tests, and `make pr-check` and `make premerge-check` fail until the task that bootstraps the development platform gives each its stages or declares `none`.

## Changing the scaffold

Commit every change under `kordal-plan/scaffold/`. A project records the scaffold commit it was created from in `docs/agents/scaffold-version`, and `/kordal-plan-update` merges from it.

```bash
bash kordal-plan/bootstrap.sh <dir>           # copy the scaffold into a project
bash kordal-plan/bootstrap.sh --diff <dir>    # what changed since the project's version; changes nothing
bash kordal-plan/bootstrap.sh --update <dir>  # apply those changes, file by file, as a three-way merge
bash kordal-plan/bootstrap.sh --stamp <dir>   # record the current version
```

`--update` compares, per file, the scaffold at the recorded version, the project's file and the scaffold now:

| Report | The file |
| --- | --- |
| not listed | The scaffold did not change it: untouched, whatever the project made of it |
| `updated` | Only the scaffold changed it: the new version |
| `merged` | Both changed it, in different places: both changes |
| `added`, `removed` | The scaffold added or dropped it, and the project held nothing of its own there |
| `kept` | The project deleted it: it stays deleted |
| `CONFLICT` | Both changed the same lines, and the file now holds both between conflict markers; or one side added or dropped a file the other holds in its own form, or the project reaches the file through a symbolic link, or Git does not track it there: the project's file is untouched |

It needs a recorded version that is a commit of this repository and that this checkout contains (an older checkout would undo what the project has), and a clean project tree, so that the update is a diff to review and to revert. Without a conflict it records the new version. With one it records nothing and exits 1: resolve, then `--stamp`, not `--update` again.

Before committing, run what CI runs:

```bash
make check
```

| Target | Runs |
| --- | --- |
| `make syntax` | `bash -n` over every shell script |
| `make test` | The tests of the skills' scripts, `tests/repo.test.mjs`, and the scaffold's tooling tests, in the scaffold |
| `make smoke` | Bootstraps a temporary project and runs its `make structure-check`, `bash tests/integration/check-docs.sh` and `make agent-check` |

`tests/repo.test.mjs` holds the repository to its own word: every skill has valid frontmatter, every command, agent, scaffold file, section, make target and flag that a skill, a document or this README names exists, and the routing table above equals the one in the scaffold's `AGENTS.md`. `.github/workflows/ci.yml` runs `make check` on every pull request and on every push to `main`, without credentials: GitHub is a fake `gh` throughout.

`kordal-plan/migrate.mjs` renames a project scaffolded when the unit was called an MVP (`"mvp"`, `mvp<N>`, "MVP <N>") to milestones; `/kordal-plan-update` runs it first.

## Status

Early and changing often. The scripts are covered by their own tests, the repository by `make check`, and the workflow carries the lessons of its first two runs. The GitHub mirror is tested against a fake `gh`.

## License

[MIT](LICENSE). Copyright (c) 2026 Kordal.
