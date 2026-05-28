#!/bin/bash
# Double-click me (Mac) to start Crosswalk. The first time, right-click me and
# choose "Open" so macOS lets it run.
cd "$(dirname "$0")" || exit 1

echo "============================================"
echo "        Starting Crosswalk..."
echo "============================================"
echo ""

# 1) Check Node.js is installed.
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is not installed yet."
  echo "   Please go to https://nodejs.org, download the big green 'LTS' button,"
  echo "   install it, then double-click this file again."
  echo ""
  read -r -p "Press Enter to close this window."
  exit 1
fi

# 2) First-time setup: install the parts it needs.
if [ ! -d node_modules ]; then
  echo "🛠  First-time setup — downloading the parts it needs (about a minute)..."
  npm install || { echo "❌ Setup failed. Make sure you have internet, then try again."; read -r -p "Press Enter to close."; exit 1; }
  echo ""
fi

# 3) Open the app in the browser once it's up.
echo "🌐 Your browser will open at http://localhost:3000 in a few seconds."
echo "   (If it shows an error at first, wait a moment and refresh.)"
echo "   Leave this window open while you use Crosswalk. Close it to stop."
echo ""
( sleep 6; open "http://localhost:3000" ) &

# 4) Start the app (this keeps running).
npm run gui
