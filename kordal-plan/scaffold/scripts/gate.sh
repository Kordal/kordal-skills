#!/usr/bin/env bash
# Runs the stages of a gate in order and reports how long each took. Used by
# `make task-check`, `make pr-check` and `make premerge-check`.
#
#   - a stage is a make target; the first stage that fails stops the gate, and
#     the gate exits with that stage's status;
#   - the report is printed when the gate ends — passed, failed or interrupted
#     — with every stage's result (passed, FAILED, not run) and duration;
#   - on GitHub Actions the report is also added to the job summary.
#
# Usage: gate.sh <gate name> <make target>...
# GATE_MAKE is the make to run (default: make).
set -uo pipefail

gate=$1
shift
stages=("$@")
make_cmd=${GATE_MAKE:-make}
results=()
durations=()
status=0
gate_start=$(date +%s)
running=""
running_start=0

clock() { printf '%d:%02d' $(($1 / 60)) $(($1 % 60)); }

report() {
	local now total i result verdict
	now=$(date +%s)
	# A stage cut short by a signal or an error of this script.
	if [ -n "$running" ]; then
		results+=("FAILED")
		durations+=($((now - running_start)))
		[ "$status" -ne 0 ] || status=1
	fi
	total=$((now - gate_start))
	if [ "$status" -eq 0 ]; then verdict=passed; else verdict=FAILED; fi
	printf '\n== %s: durations\n' "$gate"
	for i in "${!stages[@]}"; do
		result=${results[$i]:-not run}
		if [ "$result" = "not run" ]; then
			printf '%-28s %-8s %s\n' "${stages[$i]}" "$result" "-"
		else
			printf '%-28s %-8s %s\n' "${stages[$i]}" "$result" "$(clock "${durations[$i]}")"
		fi
	done
	printf '%-28s %-8s %s\n' "$gate" "$verdict" "$(clock "$total")"
	if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
		{
			printf '### %s: %s in %s\n\n| Stage | Result | Duration |\n| --- | --- | --- |\n' "$gate" "$verdict" "$(clock "$total")"
			for i in "${!stages[@]}"; do
				result=${results[$i]:-not run}
				if [ "$result" = "not run" ]; then
					printf '| `%s` | %s | - |\n' "${stages[$i]}" "$result"
				else
					printf '| `%s` | %s | %s |\n' "${stages[$i]}" "$result" "$(clock "${durations[$i]}")"
				fi
			done
			printf '\n'
		} >>"$GITHUB_STEP_SUMMARY"
	fi
	exit "$status"
}
trap report EXIT
trap 'status=130; exit 130' INT
trap 'status=143; exit 143' TERM

if [ "${#stages[@]}" -eq 0 ]; then
	echo "gate.sh: no stages given"
	status=2
	exit 2
fi

for stage in "${stages[@]}"; do
	printf '\n== %s: stage %s\n' "$gate" "$stage"
	running=$stage
	running_start=$(date +%s)
	"$make_cmd" "$stage"
	code=$?
	running=""
	durations+=($(($(date +%s) - running_start)))
	if [ "$code" -ne 0 ]; then
		results+=("FAILED")
		status=$code
		break
	fi
	results+=("passed")
done
exit "$status"
