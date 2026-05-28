#!/bin/bash
# Poll RenderCloud mesh-upload-process tasks until terminal (3=success, 4=failed).
# Prints the success/fail response (with meshId in outputs[0].content on success).
# Usage: poll-meshupload.sh <taskid> [<taskid> ...]
KEY="${AHOLO_KEY:?Set AHOLO_KEY env var (your Aholo AppKey)}"
BASE="https://api.aholo3d.com/global/rendercloud/v1/mesh-upload-process/task/get?taskid="
TIDS="$*"
echo "polling mesh-upload: $TIDS"
while true; do
  ALL_DONE=1
  LINE="$(date +%H:%M:%S)"
  for tid in $TIDS; do
    resp=$(curl -s "${BASE}${tid}" -H "Authorization: $KEY")
    status=$(echo "$resp" | grep -o '"status":[0-9]*' | head -1 | grep -o '[0-9]*$')
    [ -z "$status" ] && status="?"
    LINE="$LINE  $tid=$status"
    if [ "$status" != "3" ] && [ "$status" != "4" ]; then ALL_DONE=0; fi
    if [ "$status" = "3" ] || [ "$status" = "4" ]; then echo "$tid -> $resp"; fi
  done
  echo "$LINE"
  if [ "$ALL_DONE" = "1" ]; then echo "ALL TERMINAL"; break; fi
  sleep 20
done
