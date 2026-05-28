#!/bin/bash
# Poll Lux3D tasks until all reach a terminal status (3=success, 4=failed).
# Pure curl+grep — no python dependency. Writes a running log to stdout.
# Usage: poll-lux3d.sh <tid> [<tid> ...]
KEY="${AHOLO_KEY:?Set AHOLO_KEY env var (your Aholo AppKey)}"
TIDS="$*"
echo "polling: $TIDS"
while true; do
  ALL_DONE=1
  LINE="$(date +%H:%M:%S)"
  for tid in $TIDS; do
    resp=$(curl -s "https://api.aholo3d.com/global/lux3d/v1/generate/task/get?taskid=$tid" -H "Authorization: $KEY")
    status=$(echo "$resp" | grep -o '"status":[0-9]*' | head -1 | grep -o '[0-9]*$')
    [ -z "$status" ] && status="?"
    LINE="$LINE  $tid=$status"
    if [ "$status" = "0" ] || [ "$status" = "1" ] || [ "$status" = "?" ]; then
      ALL_DONE=0
    fi
  done
  echo "$LINE"
  if [ "$ALL_DONE" = "1" ]; then
    echo "ALL TERMINAL"
    break
  fi
  sleep 30
done
