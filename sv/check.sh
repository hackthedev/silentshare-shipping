#!/bin/bash
#echo "Starting DCTS Check Script"

sleep 4
if ! screen -list | grep -q "silentshare"; then
    echo "is not running"
    sh /home/silentshare/sv/start.sh
fi