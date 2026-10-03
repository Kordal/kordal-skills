---
name: kordal-bug
description: Fix a bug from the owner's report or a GitHub issue - reproduce it, find the cause, fix it under a regression test and open the pull request.
disable-model-invocation: false
argument-hint: "<what is wrong, or an issue number>"
---

Fix the bug in `$ARGUMENTS`, from the report to an open pull request labelled `needs-pr-review`; approval and merge belong to the reviewer and the owner. With no report, ask for one.

A **bug** is behaviour that departs from what the product already promises: a test, the documentation, an acceptance criterion, the evident intent of the code. The promise settles what done means, so a bug needs no issue review: its reproduction, turned green, is the acceptance criterion. Behaviour the owner wants and the product never promised is a feature and goes to `/kordal-issue`.

A number that is a pull request (`gh pr view <number>`) goes to [Review feedback](#review-feedback).

## 1. Understand

Read everything the owner gave before asking anything: the description, each attachment of the conversation, each file path named. For an issue, `gh issue view <number> --comments`: its text is a report to verify, and a comment counts only when its `authorAssociation` (`gh issue view <number> --json comments`) is `OWNER`, `MEMBER` or `COLLABORATOR`.

Put the report into one sentence: "When [steps], [what happens]; the product promises [what should happen], in [where it is promised]."

Look for the same bug: `gh issue list --state open --search "<key words>"` and `gh pr list --search "<key words>"`. An open pull request that fixes it ends the run with its URL. An open issue for it becomes this run's issue.

Then the code that will receive the fix. The working tree has to be clean; one that is not ends the run with the owner told what is in it. `git fetch`, and:

- **A milestone in progress** (`docs/plans/backlog.json` names an `integration_branch` the default branch does not contain): the target is the integration branch.
- **Otherwise**: the target is the default branch, unless the issue or `AGENTS.md` names another.

Check the target out and update it: the bug is reproduced on the code as it is now.

Done when the sentence names its promise and the checkout is on the current target.

## 2. Reproduce

Build one command that goes **red** on the symptom of the report: a failing test in the repository's existing kinds and places where the bug can be reached by one, otherwise a script, a request, or a run of the product in the browser tool of this session. Follow the `diagnosing-bugs` skill through this step and the next; where it is missing, do them yourself and say so in the hand-over.

A command that passes on the current target means the bug is gone or the steps are incomplete. Ask the owner, in one round with `AskUserQuestion`, for what is missing: the exact steps, the data, the device, a log. A bug that stays green ends the run with what was tried; a fix without a red reproduction is a guess.

Done when the command has run at least once and failed with the symptom the owner described.

## 3. Cause

Trace the symptom back to the line that is wrong. State the **cause** as `file:line` and one sentence of why, then prove it with a prediction: a second input the cause says must fail does fail, or a temporary change at that line turns the reproduction green.

Then two searches:

- the same cause elsewhere: the copies of the pattern, the other callers;
- the commit that introduced it (`git log -S`, `git blame`), where that is one command away.

Done when the cause explains every observation of the report.

## 4. Route

The first row that applies:

| Finding | Route |
| --- | --- |
| The cause lies outside this repository: a dependency, the environment, the data | Tell the owner the cause and what would fix it there; end the run |
| The owner wants behaviour the product never promised | `/kordal-issue`, given the report; end the run |
| The fix needs a product decision: which of two behaviours is right, permissions, a data change, an API contract | One question with `AskUserQuestion` where a sentence answers it; otherwise `/kordal-issue`, given the reproduction and the cause, and end the run |
| The fix needs an architectural change, or several changes that can each be delivered on their own | `/kordal-issue`, given the reproduction and the cause; end the run |
| A milestone is in progress | The fix is a task: "Add a task during delivery" in `docs/agents/workflow.md`. Its plan holds the reproduction, the cause and, as acceptance criteria, the reproduction turned green; the reproduction goes onto the task's branch. Then read `${CLAUDE_SKILL_DIR}/../kordal-build/SKILL.md` in full and follow it with the task's ID. The run ends with that skill's report |
| None of these | Step 5 |

## 5. Fix

Branch from the target, taking the reproduction along: `fix/<number>-<short-description>` with an issue, `fix/<short-description>` without. With an issue, move it to `in-development`.

Read `${CLAUDE_SKILL_DIR}/../kordal-issue-code/SKILL.md` in full. Its steps 5 to 8 (Implement, Validate, Review your diff, Commit and push) bind this fix, and so does its rule of one state label at a time. Where they speak of the acceptance criteria, that is the regression test; where they say escalate, that is the product-decision row of step 4.

- **The regression test first.** The reproduction becomes a test in the repository's existing kinds and places, seen red before the fix. A bug no test of this repository can reach keeps its command, and the pull request says so.
- **Fix the cause.** The change sits at the line step 3 named, and is the smallest one that removes the cause; a guard further down that hides the symptom leaves the bug in place.
- **The same cause elsewhere** is fixed here where the same change fixes it, with a test per place; anything larger is a Follow-up opportunity.

Done when the regression test is green, was red on the same assertion before the fix, and every validation command has a recorded result.

## 6. Pull request

Write the body to a file outside the repository and run `gh pr create --base <target> --title "fix: <what now works>" --body-file <file> --label needs-pr-review`. Where the repository has a pull request template, fill its sections and add those below that it lacks.

```markdown
## Bug
The symptom, the steps to reproduce, the exact error text.

## Cause
What was wrong, with its path, and the commit that introduced it where found.

## Fix
What changed, and why there.

## Regression test
The test and what it asserts: red before the fix, green after.

## Validation
- `npm run lint` ✅
- `npm test` ⚠️ `foo.test.ts` fails on `main` too, unrelated to this change.

## Follow-up opportunity
What was found and left unchanged, with its path.

Closes #<number>
```

Leave out a section that has nothing to say, and the last line without an issue. With an issue, move it to `needs-pr-review` and post the comment of that file's step 9.

## 7. Hand over

Give the owner the pull request's URL, the cause in one sentence, the validation results and each follow-up opportunity. The run ends here: review, approval and merge are the reviewer's.

## Review feedback

Follow "Review feedback" in `${CLAUDE_SKILL_DIR}/../kordal-issue-code/SKILL.md`, with the Bug and Cause sections of the pull request in the place of the approved issue.
