#!/usr/bin/env bash
# Makes sure the repository of this checkout has every state label of the issue
# workflow, so that no later command meets a missing one: `gh issue edit
# --add-label` and `gh pr create --label` fail on a label that does not exist.
#
#   labels.sh    one `gh label list`, then one `gh label create` for each label
#                the repository lacks; prints which it created
#
# GH names the gh binary; the tests put a fake there. A failing gh fails the
# run: the caller must not go on to label anything.
set -euo pipefail

gh=${GH:-gh}
# name|description, in the order an issue passes through them; it carries one at a time.
labels='needs-review|Written, not yet judged: awaiting /kordal-issue-review
needs-rework|Reviewed: the text has to change, or the issue has to be split
needs-info|A product decision is missing: answer it on the issue
duplicate|Another issue holds the work
already-implemented|The code already does it
ready-for-dev|Reviewed: a coding agent can implement it as it stands
in-development|Being implemented on its branch
needs-pr-review|The pull request is open'

# gh lists 30 labels unless told otherwise: a label past them would be created a second time, and fail.
if ! existing=$("$gh" label list --limit 1000 --json name --jq '.[].name'); then
	echo "FAIL     gh label list failed: no label was created. Is gh logged in, and is origin a GitHub repository?" >&2
	exit 1
fi

created=0
while IFS='|' read -r name description; do
	# GitHub treats label names as case-insensitive: "Duplicate" is the label.
	# No pipe: grep -q leaves at its first match, and under pipefail the writer it cut off would turn a found label into a missing one.
	if grep -Fxqi -e "$name" <<<"$existing"; then continue; fi
	if ! "$gh" label create "$name" --description "$description" </dev/null >/dev/null; then
		echo "FAIL     gh label create $name failed" >&2
		exit 1
	fi
	echo "created  $name"
	created=$((created + 1))
done <<EOF
$labels
EOF
[ "$created" -gt 0 ] || echo "labels   every state label exists"
