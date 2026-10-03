---
name: kordal-issue
description: Write a GitHub issue a coding agent can implement without guessing - only when the owner asks for an issue or wants the work handed off for later, or the repository is managed through reviewed issues. A direct request to build something goes to /kordal-quick, /kordal-plan-feature or /kordal-plan.
disable-model-invocation: false
argument-hint: "<what is wanted or wrong>"
---

Turn `$ARGUMENTS` into a GitHub issue that a coding agent with no view of this conversation can implement with minimal guessing. The issue states what has to be achieved and what done means; the implementer chooses how. The run changes no code and creates one issue, labelled `needs-review`. With no description, ask for one.

The issue workflow applies in three cases only: the owner asks for an issue, the owner wants the work handed off for later, or the repository is managed through reviewed GitHub issues. What `/kordal-quick` or `/kordal-bug` sent here is such a hand-off. A direct request to build something is routed, and no issue is written: `/kordal-quick` for one clear, localized, low-risk change; `/kordal-plan-feature` for a small addition of one to three tasks; `/kordal-plan` for more, or for a new architecture decision; `/kordal-bug` for behaviour that departs from what the product already promises. Name the level and stop.

## 1. Understand

Read everything the owner gave before asking anything: the description, each attachment of the conversation, each file path named. A screenshot shows the page, the device width and the state; a log or a pasted error gives the exact text; a recording gives the steps. Decide what it is: a **feature**, a **bug**, an **improvement** of something that exists, or a **chore** (upkeep with no change for users). Put the request into one sentence: who gets which change, and why.

The owner is the only source of requirements. Something you would add yourself goes under "Assumptions / Open Questions", worded as a question.

## 2. Inspect the repository

Find these, and note each with its path:

- the page, feature, component, module, API or service the change touches;
- what exists and should be reused: a shared component, a helper, an existing flow;
- a similar implementation elsewhere that sets the pattern to follow;
- the conventions that bind the change: `AGENTS.md`, `CLAUDE.md`, the ADRs, permission rules, naming;
- dependencies and constraints: what has to exist first, what the change may break;
- how this area is tested, and with which command;
- for a bug: where it happens, and the cheapest reproduction (a unit test, a command, a request), with no heavy stack started for it;
- for each attachment: the page a screenshot shows, the line an error in a log comes from.

Search for the same issue: `gh issue list --state all --search "<key words>"`. An open duplicate ends the run: show it to the owner and offer to add what is new as a comment.

Done when every detail the repository can answer is answered from it. Of what remains, ask the owner only the questions whose answer changes what gets built, in one round with `AskUserQuestion`; the rest becomes a stated assumption.

## 3. Size

One issue is one change an agent delivers in one pull request. A request that holds several separately deliverable changes is too large: show the owner the split, continue with the part they choose, and name the other parts under Scope as not included.

## 4. Draft

**Title**: action-oriented, under 70 characters: "Add an "Add server" button to the server list header".

**Body**:

```markdown
## Summary
What should change and why, in two or three sentences.

## Current Behavior
What happens today. For a bug: the steps to reproduce and the exact error text.

## Expected Behavior
What happens after the change, as behaviour someone can observe.

## Scope
What this issue includes. What it leaves out, where a reader could assume otherwise.

## Repository Context
The findings of step 2, each with its path: the affected page or feature, the components
and services involved, what to reuse, the similar implementation, the conventions that apply.

## Acceptance Criteria
- [ ] One observable result per checkbox.

## Edge Cases
Those that apply here: permissions, loading state, empty state, API errors, duplicate
actions, responsive behaviour.

## Testing Expectations
What has to be verified, in the repository's own testing conventions and commands.

## Attachments
What each attachment shows and what in it is wrong; the lines of a log that matter, in a
code block.

## Assumptions / Open Questions
What could not be determined. A question whose answer changes the implementation is
marked **blocking**.
```

Leave out a section that has nothing to say, such as Current Behavior for something entirely new.

Rules for the text:

- **Acceptance criteria are testable**: each names a result a test or a look at the product confirms. "Clicking the button opens the existing server creation flow", "The existing shared `Button` component is used", "The button follows the existing permission rules", "Relevant automated tests are added or updated"; never "works correctly".
- **Repository Context holds facts**: only what you read, with its path. A file you expect to be involved but did not confirm is marked "suspected".
- **Outcome over approach**: where several implementations are valid, state the result and the constraint and leave the choice to the implementer. Name a specific component, pattern or module only where the repository already settles it.
- **No context assumed**: name the screen, the command, the file; spell out the owner's shorthand. The issue has to stand without the attachments, since the command line cannot upload one.

## 5. Self-check

Answer each against the draft; rewrite what fails and check again:

- Is the goal clear from Summary and Expected Behavior alone?
- Could a coding agent tell what done means from the Acceptance Criteria alone?
- Is every criterion testable?
- Is every reuse and pattern claim backed by something read in step 2?
- Does every requirement trace back to the owner's words?
- Is every assumption that matters written down, the blocking ones marked?
- Does the issue fit one pull request?

Done when every answer is yes.

## 6. Create

Run `bash ${CLAUDE_SKILL_DIR}/labels.sh` first: it creates each state label of the issue workflow the repository lacks, so that no later command meets a missing one. Then two labels: `needs-review`, and the kind label the repository already has (`gh label list`), such as `bug` or `enhancement`; without a fitting one, `needs-review` alone. The status labels (`waiting`, `blocked`, `ready`, `in-progress`, `done`) belong to the tasks of the backlog and are never set here.

Write the body to a file outside the repository and run `gh issue create --title "<title>" --body-file <file> --label needs-review --label <kind>`. The repository is this checkout's `origin`.

## 7. Hand over

Give the owner the issue's URL and the assumptions and open questions, the blocking ones first. Where a picture or a recording says more than its description, name the files and ask the owner to drag them into the issue on GitHub.

Then what follows: `/kordal-issue-review <number>` judges the issue and alone marks it `ready-for-dev`.
