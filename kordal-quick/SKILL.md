---
name: kordal-quick
description: Make one clear, low-risk, localized change directly and open its pull request - no plan, no task, no issue. Anything risky or unclear is escalated to /kordal-plan-feature or /kordal-plan.
disable-model-invocation: false
argument-hint: "<request>"
---

Make the change in `$ARGUMENTS` and stop at its open pull request, which the owner merges. With no request, ask for one.

QUICK is the lowest level of one ladder, QUICK → FEATURE → MILESTONE: each level takes what the level below must refuse. Its whole footprint is one branch, the commits of one change and one pull request:

- It creates no milestone, backlog task, GitHub issue, task plan, Mermaid flow, summary page, integration branch or approval gate, and it merges nothing.
- It needs no scaffold: any Git repository with a GitHub `origin` will do.
- It uses neither the gate helper (`node scripts/agent-local.mjs gate`) nor a reviewer agent. Its proof is the targeted validation of step 5 and your own reading of the diff in step 6; its review is the owner's, on the pull request.

## 1. Qualify

Every condition must hold. Tick each against the request, opening code only where a condition cannot be judged without it:

- [ ] one coherent, localized change
- [ ] the requirement is already clear
- [ ] follows an existing implementation pattern
- [ ] no new architecture decision or ADR
- [ ] no database or schema migration
- [ ] no authentication, authorization or permission change
- [ ] no change to how sensitive data is handled
- [ ] no new production dependency
- [ ] no infrastructure, deployment or CI change
- [ ] no public API or durable contract change
- [ ] no destructive operation
- [ ] no uncertainty that materially changes product behaviour

A condition that fails, or that you cannot tick with certainty, ends the run: [escalate](#escalate). A request is never stretched to fit.

**During an active milestone**, in a scaffolded project whose integration branch (`integration_branch` of `docs/plans/backlog.json`) holds work the base branch lacks: `git diff --name-only <base>...<integration>` lists the files the milestone has changed. A change that touches none of them is still QUICK, from the base branch. One that touches any joins the milestone instead: `/kordal-plan-feature`, or `/kordal-bug` for a bug.

Done when every box is ticked, or the run has ended with the failed condition named.

## 2. Inspect

Read only what the change sits in: the code it touches, the existing implementation whose pattern it follows, and the tests of both. Done when you can name the files that will change, the pattern they follow and the test that will prove the change, and none of those files is on the milestone's list of step 1.

## 3. Branch

The working tree has to be clean (`git status --porcelain` prints nothing); one that is not ends the run with the owner told what is in it. `git fetch`, then find the base branch:

- **a scaffolded project** (it has `docs/plans/backlog.json`): `node scripts/agent-local.mjs base`, the `base_branch` of the manifest;
- **any other repository**: its default branch, `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`, or `git symbolic-ref --short refs/remotes/origin/HEAD`.

Branch from its fetched tip: `git switch -c quick/<short-description> --no-track origin/<base>`, as in `quick/fix-empty-state-label`. Done when the checkout is on that branch and you have noted the branch it was on before.

## 4. Change

Make the smallest change that satisfies the request, in the pattern step 2 found, with its test where the repository tests that kind of code. Done when the request is met and every changed line serves it.

## 5. Validate

Targeted, and nothing broader:

- the tests of the changed area;
- lint, format and type check of the changed files;
- what the repository's CI requires for those paths, where it runs locally with nothing started.

A failure your change caused is fixed before going on. Done when each command has a recorded result, exactly as it ran: a check that was not run is recorded as not run, and one that only CI can run as left to CI.

## 6. Review your diff

`git diff` and `git status`, read whole, once, as the reviewer the change will not otherwise have:

- it does what was asked, and nothing else: no debug code, stray file or reformatted line you did not otherwise touch;
- no key, token, password or `.env` content;
- every condition of step 1 still holds for what the diff actually does.

A diff that reveals elevated risk is no longer QUICK: [escalate](#escalate), and do not open the pull request. Done when the diff holds the change and nothing else; then commit it, in the repository's commit convention.

## 7. See it

Where the change is visible to a user, look at it once, the cheapest way that shows it: a focused test that renders it, its story, or one check in the browser tool of this session where the product already runs or starts with one command. A full acceptance environment is out of proportion: no seeded stack, no emulator, no device run. What the look shows wrong returns to step 4. Done when you have seen the changed behaviour, or can say in the pull request why it was not seen.

## 8. Pull request

Push the one branch, without force: `git push -u origin quick/<short-description>`. Write the body to a file outside the repository and run `gh pr create --base <base> --title "<title>" --body-file <file>`, with no label: one the repository lacks would fail the command. Where the repository has a pull request template, fill its sections and add those below that it lacks.

```markdown
## Summary
What changed for the user and why, in two or three sentences.

## Change
- The files changed, and the existing pattern the change follows.

## Validation
- `<command>`: the result as it ran. A check that was not run: "not run", with the reason.

## How to see it
The two or three steps by which the owner sees it working, and what step 7 saw.
```

Done when the pull request is open against the base branch.

## 9. Stop

Give the owner the pull request's URL, the validation results, and the branch the checkout was on before, which they can switch back to. The run ends here: review and merge are the owner's.

## Escalate

At any step, as soon as a condition of step 1 fails or turns uncertain. Stop, tell the owner which condition and what showed it, and name the next level:

- `/kordal-plan-feature <request>`: it fits one to three tasks and needs no new architecture decision;
- `/kordal-plan`: it is larger, or needs an architecture decision;
- `/kordal-issue <request>`: the repository has no scaffold.

Commit work already done on its `quick/` branch, unpushed and without a pull request, and name the branch: the next level decides what to take from it.
