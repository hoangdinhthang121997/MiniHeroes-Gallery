@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo  Hero Gallery - Mini Heroes Regional Server Discovery
echo ============================================================
echo.
where node >nul 2>nul || (echo Node.js is required for this OPTIONAL step.
echo Download/install the current Node.js LTS, then run this file again.
pause & exit /b 1)
node "tools\exporter\discover-hosts.mjs" --restart --seconds 120 --out "%cd%\discovered-hosts.txt"
if errorlevel 1 (echo. & echo Discovery did not complete. Read the message above. & pause & exit /b 1)
echo.
echo SUCCESS: discovered-hosts.txt is ready.
echo Open "SERVER FIX.html" in this folder and follow the converter steps.
pause
