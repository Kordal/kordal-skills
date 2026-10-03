---
name: kordal-issue
description: Turn the owner's rough description of a bug, an idea or a request into a clear GitHub issue in this project's repository.
disable-model-invocation: false
argument-hint: "<what is wrong or wanted>"
---

Turn `$ARGUMENTS` into a GitHub issue that someone who never saw this conversation can act on. The run changes no code and creates one issue, after the owner has seen it. With no description, ask for one.

## 1. Understand

Start from everything the owner gave, not the sentence alone: look at each attachment of the conversation and each file path in the description. A screenshot shows the page, the device width and the state; a log or a pasted error gives the exact text; a recording gives the steps. Read every one before asking anything.

Decide what it is: a **bug** (something behaves wrongly), a **feature** (something is wanted) or a **chore** (upkeep with no change for users). Find the answers you can find yourself, in the attachments and in step 2; ask the owner only for what remains, in one round with `AskUserQuestion`: what they expected, how often it happens, who is affected.

## 2. Ground it

- Read the code the description points at. For a bug, find where it happens and try the cheapest reproduction: a unit test, a command, a request. Start no heavy stack for it.
- Search for the same issue: `gh issue list --state all --search "<key words>"`. An open duplicate ends the run: show it to the owner and offer to add what is new as a comment.
- Tie each attachment to the code: the page a screenshot shows, the line an error in a log comes from.
- Keep apart what you observed, what the attachments show, what you read in the code and what you only suspect.

## 3. Draft

**Title**: under 70 characters, the problem or the outcome in plain words, not the solution. "Reminder is sent twice when the invoice is edited", not "Fix reminder bug".

**Body**, by kind:

| Bug | Feature | Chore |
| --- | --- | --- |
| What happens | Who needs it and why: "A [user] can [do something], demonstrated by [result]" | What and why now |
| What should happen | How it is today | What done looks like |
| Steps to reproduce, numbered, from a clean start | What is wanted, as behaviour the user sees | What it touches |
| Where: `file:line`, marked observed or suspected | Acceptance: checkboxes of observable results | |
| How often, who is affected, any workaround | Out of scope; open questions | |

Rules for the text:

- Write for a reader with no context: name the screen, the command, the file. Spell out what the owner's shorthand meant.
- Quote the owner's own words where they carry the point, and the exact error text or output in a code block.
- State facts and their source. A cause you did not confirm is written as a suspicion.
- Describe the problem and the wanted result; leave the solution to whoever takes the issue, unless the owner asked for one.
- Put what an attachment shows into words, under "Attachments": what is on the screenshot and what in it is wrong, the lines of the log that matter in a code block. The issue has to stand without the file, since the command line cannot upload one.
- Short sections, no filler, no praise, no apology.

**Labels**: only labels the repository already has (`gh label list`), such as `bug` or `enhancement`. The `status:` labels belong to the tasks of the backlog and are never set here.

## 4. Confirm and create

Show the owner the title, the labels and the body as they will appear. Create the issue on their yes, with their changes: write the body to a file outside the repository and run `gh issue create --title "<title>" --body-file <file> --label <labels>`. The repository is this checkout's `origin`.

## 5. Hand over

Give the owner the issue's URL. Where a picture or a recording says more than its description, name the files and ask the owner to drag them into the issue on GitHub. Then say what could follow: `/kordal-plan-feature` with the issue's number for a feature that fits the short path, `/kordal-plan` for more, or nothing for an issue that waits. An issue made here is not a task: it enters the backlog only through planning.
