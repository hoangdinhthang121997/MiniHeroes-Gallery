@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is required. & pause & exit /b 1)
node "tools\exporter\restore.mjs"
pause
