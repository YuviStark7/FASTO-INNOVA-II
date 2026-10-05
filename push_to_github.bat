@echo off
rem Commits whatever changed in this folder and pushes it to GitHub.
rem Runs on YOUR computer, so it uses the GitHub login Git already has
rem (no token is ever shared with Claude). Safe to run by hand: double-click it.
rem Also removes the stale lock files that Claude's sandbox can leave behind.

cd /d "%~dp0"
echo. >> push_log.txt
echo ===== %date% %time% ===== >> push_log.txt

if exist .git\index.lock del /f .git\index.lock
if exist .git\HEAD.lock del /f .git\HEAD.lock
if exist .git\refs\heads\main.lock del /f .git\refs\heads\main.lock
for /d %%d in (.git\objects\??) do del /f /q "%%d\tmp_obj_*" >nul 2>&1

git add -A >> push_log.txt 2>&1
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Fasto Innova update %date%" >> push_log.txt 2>&1
) else (
  echo Nothing new to commit. >> push_log.txt
)

git push origin main >> push_log.txt 2>&1
if errorlevel 1 (
  echo PUSH FAILED - see push_log.txt
  echo PUSH FAILED >> push_log.txt
) else (
  echo Pushed. >> push_log.txt
  echo Pushed to GitHub.
)
