@echo off
REM Double-click me (Windows) to start Crosswalk.
cd /d "%~dp0"

echo ============================================
echo         Starting Crosswalk...
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed yet.
  echo Please go to https://nodejs.org, download the big green "LTS" button,
  echo install it, then double-click this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First-time setup - downloading the parts it needs ^(about a minute^)...
  call npm install || (echo Setup failed. Check your internet and try again. & pause & exit /b 1)
  echo.
)

echo Your browser will open at http://localhost:3000 in a few seconds.
echo (If it shows an error at first, wait a moment and refresh.)
echo Leave this window open while you use Crosswalk. Close it to stop.
echo.
start "" http://localhost:3000
call npm run gui
