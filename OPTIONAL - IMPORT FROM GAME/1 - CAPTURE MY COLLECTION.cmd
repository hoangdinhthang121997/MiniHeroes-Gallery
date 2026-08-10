@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo  Hero Gallery - Optional Mini Heroes Collection Import
echo ============================================================
echo.
where node >nul 2>nul || (echo Node.js is required for this OPTIONAL step.
echo Download/install the current Node.js LTS, then run this file again.
pause & exit /b 1)
node "tools\exporter\export.mjs" --restart --out "%cd%\roster.json"
if errorlevel 1 (echo. & echo Capture did not complete. Read the message above. & pause & exit /b 1)
echo.
echo SUCCESS: roster.json is ready.
echo Open ..\START HERE.html, choose Import, and select this roster.json.
pause
