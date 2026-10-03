#!/usr/bin/env bash
# Runs the stages of a gate in order and reports how long each took. Used by
# `make task-check`, `make pr-check` and `make premerge-check`.
#
#   - a stage is a make target; the first stage that fails stops the gate, and
#     the gate exits with that stage's status;
#   - a gate with no stages fails (exit 2): an empty stage list is a gate that
#     nobody decided on. The single word `none` declares the gate not
#     applicable: nothing runs, it is reported as n/a and exits 0. `none`
#     beside other stages is an error (exit 2);
#   - the report is printed when the gate ends — passed, failed or interrupted
#     — with every stage's result (passed, FAILED, not run) and duration;
#   - on GitHub Actions the report is also added to the job summary;
#   - when GATE_REPORT names a file, the report is also written to it, as one
#     JSON object on one line, for scripts/agent-local.mjs to record:
#       {"gate":"task-check","result":"passed|failed|not-applicable","seconds":12,
#        "stages":[{"name":"lint","result":"passed|failed|not run","seconds":3}]}
#     A stage that did not run has 0 seconds; a gate that is not applicable,
#     or whose stage list was refused, has no stages.
#
# Usage: gate.sh <gate name> <make target>...
#        gate.sh <gate name> none
# GATE_MAKE is the make to run (default: make). The gate name and the stages
# are make targets of letters, digits, ".", "_" and "-": anything else is
# rejected (exit 2) rather than written into a broken report.
set -uo pipefail

# A make target, and safe inside JSON as it stands. The subshell keeps
# LC_ALL=C, under which a range is ASCII in every locale, away from the stages.
valid_name() { (LC_ALL=C; case $1 in '' | *[!a-zA-Z0-9_.-]*) exit 1 ;; esac); }

if ! valid_name "${1:-}"; then
	echo 'Usage: gate.sh <gate name> <make target>... (or the single word none); a name is letters, digits, ".", "_" and "-"'
	exit 2
fi
gate=$1
shift
stages=("$@")
make_cmd=${GATE_MAKE:-make}
# The report is this gate's own: a stage that runs a gate itself, as the tests
# of this script do, must not write to it.
report_file=${GATE_REPORT:-}
unset GATE_REPORT
results=()
durations=()
status=0
applicable=yes
gate_start=$(date +%s)
running=""
running_start=0

clock() { printf '%d:%02d' $(($1 / 60)) $(($1 % 60)); }

# $1 the verdict of the report, $2 the seconds of the gate. Every name passed
# valid_name, so nothing needs escaping.
json_report() {
	local i result sep=""
	case $1 in passed) result=passed ;; n/a) result=not-applicable ;; *) result=failed ;; esac
	printf '{"gate":"%s","result":"%s","seconds":%d,"stages":[' "$gate" "$result" "$2"
	for i in "${!stages[@]}"; do
		case ${results[$i]:-} in passed) result=passed ;; FAILED) result=failed ;; *) result="not run" ;; esac
		printf '%s{"name":"%s","result":"%s","seconds":%d}' "$sep" "${stages[$i]}" "$result" "${durations[$i]:-0}"
		sep=,
	done
	printf ']}\n'
}

report() {
	local now total took i result verdict
	now=$(date +%s)
	# A stage cut short by a signal or an error of this script.
	if [ -n "$running" ]; then
		results+=("FAILED")
		durations+=($((now - running_start)))
		[ "$status" -ne 0 ] || status=1
	fi
	total=$((now - gate_start))
	took=$(clock "$total")
	if [ "$status" -ne 0 ]; then
		verdict=FAILED
	elif [ "$applicable" = yes ]; then
		verdict=passed
	else
		verdict=n/a
		took=-
	fi
	printf '\n== %s: durations\n' "$gate"
	for i in "${!stages[@]}"; do
		result=${results[$i]:-not run}
		if [ "$result" = "not run" ]; then
			printf '%-28s %-8s %s\n' "${stages[$i]}" "$result" "-"
		else
			printf '%-28s %-8s %s\n' "${stages[$i]}" "$result" "$(clock "${durations[$i]}")"
		fi
	done
	printf '%-28s %-8s %s\n' "$gate" "$verdict" "$took"
	if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
		if [ "$verdict" = n/a ]; then
			printf '### %s: n/a\n\nNot applicable: its stage list is `none`.\n\n' "$gate"
		else
			printf '### %s: %s in %s\n\n| Stage | Result | Duration |\n| --- | --- | --- |\n' "$gate" "$verdict" "$took"
			for i in "${!stages[@]}"; do
				result=${results[$i]:-not run}
				if [ "$result" = "not run" ]; then
					printf '| `%s` | %s | - |\n' "${stages[$i]}" "$result"
				else
					printf '| `%s` | %s | %s |\n' "${stages[$i]}" "$result" "$(clock "${durations[$i]}")"
				fi
			done
			printf '\n'
		fi >>"$GITHUB_STEP_SUMMARY"
	fi
	# A report file that cannot be written does not change the verdict.
	[ -z "$report_file" ] || json_report "$verdict" "$total" >"$report_file"
	exit "$status"
}
trap report EXIT
trap 'status=130; exit 130' INT
trap 'status=143; exit 143' TERM

# A stage list that is no decision: nothing runs, the gate fails, and the
# report names no stage (an invalid name would break the JSON).
refuse() {
	printf 'gate.sh: %s\n' "$1"
	stages=()
	status=2
	exit 2
}

if [ "${#stages[@]}" -eq 0 ]; then
	refuse "$gate has no stages: name its make targets in the Makefile, or declare the gate not applicable with the single word \`none\`"
fi
for stage in "${stages[@]}"; do
	valid_name "$stage" || refuse "$gate: \"$stage\" is not a stage: a stage is a make target of letters, digits, \".\", \"_\" and \"-\""
done
if [ "${#stages[@]}" -eq 1 ] && [ "${stages[0]}" = none ]; then
	printf '\n== %s: not applicable (its stage list is `none`)\n' "$gate"
	applicable=no
	stages=()
	exit 0
fi
for stage in "${stages[@]}"; do
	[ "$stage" != none ] || refuse "$gate mixes \`none\` with stages: \`none\` stands alone and declares the gate not applicable"
done

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
