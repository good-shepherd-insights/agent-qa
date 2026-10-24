#!/bin/sh
echo 'AGENT_QA_EVENT:{"seq":1,"ts":1,"runId":"r","type":"testStarted","payload":{"testId":"t","testIndex":0,"name":"test"}}'
n=1
while true; do
  n=$((n+1))
  echo "AGENT_QA_EVENT:{\"seq\":$n,\"ts\":$n,\"runId\":\"r\",\"type\":\"heartbeat\",\"payload\":{}}"
  sleep 2
done
