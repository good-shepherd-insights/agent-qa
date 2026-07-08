#!/bin/sh
echo 'AGENT_QA_EVENT:{"seq":1,"ts":1,"runId":"r","type":"testStarted","payload":{"testId":"t","testIndex":0,"name":"test"}}'
echo 'AGENT_QA_EVENT:{"seq":2,"ts":2,"runId":"r","type":"testFinished","payload":{"testId":"t","testIndex":0,"outcome":"failed"}}'
exit 1
