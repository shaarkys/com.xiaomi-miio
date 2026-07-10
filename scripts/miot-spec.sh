#!/usr/bin/env bash
# Fetch a Xiaomi MIoT device spec and write a flat siid/piid/aiid map to <model>.txt
#
# Usage:
#   ./scripts/miot-spec.sh                 # prompts for the model
#   ./scripts/miot-spec.sh xiaomi.fan.p85  # or pass it as an argument
#
# Output: <model>.txt in the current directory.
# Requires: curl, jq

set -euo pipefail

API="https://miot-spec.org/miot-spec-v2"

for bin in curl jq; do
  command -v "$bin" >/dev/null 2>&1 || { echo "error: '$bin' is required but not installed" >&2; exit 1; }
done

MODEL="${1:-}"
if [ -z "$MODEL" ]; then
  printf 'Model (e.g. xiaomi.fan.p85): '
  read -r MODEL
fi
MODEL="$(printf '%s' "$MODEL" | tr -d '[:space:]')"
[ -n "$MODEL" ] || { echo "error: no model given" >&2; exit 1; }

echo "Looking up URN for $MODEL ..." >&2
URN="$(curl -fsS "$API/instances?status=all" \
  | jq -r --arg m "$MODEL" '[.instances[] | select(.model == $m) | .type] | last // empty')"

[ -n "$URN" ] || { echo "error: model '$MODEL' not found in the MIoT spec index" >&2; exit 1; }
echo "URN=$URN" >&2

OUT="$MODEL.txt"
{
  echo "# $MODEL"
  echo "# $URN"
  echo "# siid/piid/aiid map (generated $(date -u +%Y-%m-%dT%H:%M:%SZ))"
  echo

  curl -fsS "$API/instance?type=$URN" | jq -r '
    def vals:
      if .["value-list"] then " = [" + ([.["value-list"][].value | tostring] | join(",")) + "]"
      elif .["value-range"] then " = range" + (.["value-range"] | tostring)
      else "" end;
    .services[]
    | .iid as $s | .description as $sd
    | "\u2500\u2500 service \($s): \($sd)",
      ((.properties // [])[] | "   siid \($s) piid \(.iid)  \(.description) [\(.format)]\(.access | if index("write") then " R/W" else " R" end)" + vals),
      ((.actions // [])[]    | "   siid \($s) aiid \(.iid)  \(.description) (action)")
  '
} > "$OUT"

echo "Wrote $OUT" >&2
