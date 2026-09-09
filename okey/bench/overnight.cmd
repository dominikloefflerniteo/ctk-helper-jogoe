@echo off
REM Unattended overnight benchmark, started by the Windows task "okey-overnight-bench".
REM
REM Scheduled for 01:00; campaign.mjs stops screening at 03:00 and everything at
REM 08:40, then writes okey\bench\overnight-report.md. The deadline is honoured
REM inside the game loop, so it stops on time with partial results instead of
REM running into the morning.
REM
REM Cancel with:  schtasks /delete /tn "okey-overnight-bench" /f
REM Run it now:   schtasks /run /tn "okey-overnight-bench"

cd /d "C:\Users\Jogoe\Documents\GitHub\ctk-helper-jogoe"
echo ==== okey overnight campaign started %DATE% %TIME% ==== >> okey\bench\overnight-run.log
"C:\Program Files\nodejs\node.exe" okey\bench\campaign.mjs --screen-until=03:00 --verify-until=08:40 --screen-games=1500 --verify-games=3500 --shards=9 --top=4 >> okey\bench\overnight-run.log 2>&1
echo ==== finished %DATE% %TIME% (exit %ERRORLEVEL%) ==== >> okey\bench\overnight-run.log
