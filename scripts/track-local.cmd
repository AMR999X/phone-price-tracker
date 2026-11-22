@echo off
rem Run by Windows Task Scheduler: idealo blocks GitHub's servers, so the scrape runs from this PC.
cd /d "%~dp0.."
git pull --rebase --autostash -q
call npm run track
git add public/data data
git diff --cached --quiet || git commit -q -m "prices (PC)"
git push -q
