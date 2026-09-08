@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js 18+ and run this file again.
  pause
  exit /b 1
)
echo Starting SANI CHECKERS on http://localhost:3000 ...
start "SANI CHECKERS" cmd /c "timeout /t 1 /nobreak >nul & start http://localhost:3000"
node server.js
pause
