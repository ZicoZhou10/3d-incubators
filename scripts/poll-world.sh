#!/bin/bash
# Poll World generations until terminal (SUCCEEDED/FAILED/CANCELLED).
# Pure curl+grep. Usage: poll-world.sh <worldId> [<worldId> ...]
KEY="${AHOLO_KEY:?Set AHOLO_KEY env var (your Aholo AppKey)}"
IDS="$*"
echo "polling worlds: $IDS"
while true; do
  ALL_DONE=1
  LINE="$(date +%H:%M:%S)"
  for wid in $IDS; do
    resp=$(curl -s "https://api.aholo3d.com/global/world/v1/$wid" -H "Authorization: $KEY")
    status=$(echo "$resp" | grep -o '"status":"[A-Z_]*"' | head -1 | sed 's/.*:"//;s/"//')
    [ -z "$status" ] && status="?"
    LINE="$LINE  $wid=$status"
    case "$status" in
      SUCCEEDED|FAILED|CANCELLED) ;;
      *) ALL_DONE=0 ;;
    esac
  done
  echo "$LINE"
  if [ "$ALL_DONE" = "1" ]; then
    echo "ALL TERMINAL"
    break
  fi
  sleep 45
done
