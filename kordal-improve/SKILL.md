---
name: kordal-improve
description: Investigate an improvement question about the product or its code and return evidenced findings and ranked proposals for the owner to choose from.
disable-model-invocation: false
argument-hint: "<question>"
---

Investigate the question in `$ARGUMENTS`: about how the product behaves for its users, or about the code itself. The run changes no code; it ends in proposals the owner chooses from and a saved report. With no question, ask for one.

## 1. Frame

Turn the question into two to four criteria that can be checked: what "better" would mean here. Confirm them with the owner through `AskUserQuestion`, and take the criteria the owner adds. Done when the owner has confirmed the list.

## 2. Observe

Where the question concerns behaviour, start the product and use the part in question the way a user would, once per criterion. Write down what you saw. Where the product cannot be started, say so and continue from the code alone. A question about the code itself skips this step.

## 3. Investigate

Dispatch the `kordal-investigator` agent in the foreground (a generic subagent where that agent is missing, and then say so in the report). Give it the question, the confirmed criteria, the repository path, and your observations.

Check its report before passing it on: open each cited `file:line`, and drop or mark "unverified" a finding whose evidence you cannot find.

## 4. Report

Show the owner the findings, the ranked proposals with the recommendation, and what is already fine.

## 5. Choose

Ask the owner for a verdict on each proposal: now, later, or no with the reason. Done when every proposal has one.

## 6. Record

Write `docs/product/improvements/<date>-<slug>.md`: the question, the criteria, the findings with their evidence, the proposals, and the owner's verdict on each. Then tell the owner what follows from the verdicts:

- **Now, and it fits a feature**: give the exact command to type, `/kordal-plan-feature <the proposal's sentence>`; proposals that belong together go into one command.
- **Now, and it needs a milestone or an architecture decision**: `/kordal-plan`, whose baseline reads this report.
- **Later**: the report keeps it as a candidate for the next milestone.
- **No**: the report keeps the reason, so the proposal is not made again.

The report is a planning document: commit it on the base branch when this checkout is on it (`node scripts/agent-local.mjs base` prints it; in a repository without the scaffold, the default branch); otherwise leave it for the owner and say where it is.
