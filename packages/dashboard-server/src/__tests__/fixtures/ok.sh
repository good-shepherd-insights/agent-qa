#!/bin/sh
echo 'AGENT_QA_EVENT:{"seq":1,"ts":1,"runId":"r","type":"testStarted","payload":{"testId":"t","testIndex":0,"name":"test"}}'
echo 'AGENT_QA_EVENT:{"seq":2,"ts":2,"runId":"r","type":"testFinished","payload":{"testId":"t","testIndex":0,"outcome":"passed"}}'
echo 'AGENT_QA_EVENT:{"seq":3,"ts":3,"runId":"r","type":"runFinished","payload":{"aggregateVerdict":"passed","disposition":"detached","finalSeq":3}}'
exit 0
