#!/bin/bash
# 自动化调试脚本

# 1. 打开浏览器到 localhost:3000
open -a "Google Chrome" "http://localhost:3000"

# 2. 等待 2 秒让页面加载
sleep 2

# 3. 截图浏览器窗口
screencapture -l$(osascript -e 'tell app "Google Chrome" to id of window 1') /tmp/pactum_browser.png

# 4. 显示截图路径
echo "Screenshot saved to: /tmp/pactum_browser.png"
ls -lh /tmp/pactum_browser.png
