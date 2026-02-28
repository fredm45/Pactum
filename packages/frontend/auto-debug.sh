#!/bin/bash
# 自动化调试脚本

echo "=== Auto Debug Script ==="
echo "1. Refreshing page..."
osascript -e 'tell application "Google Chrome" to reload active tab of window 1'

echo "2. Waiting for render..."
/bin/sleep 4

echo "3. Taking screenshot..."
screencapture -x /tmp/pactum_debug.png

echo "4. Screenshot saved: /tmp/pactum_debug.png"
file /tmp/pactum_debug.png

echo "5. Done! Check /tmp/pactum_debug.png"
