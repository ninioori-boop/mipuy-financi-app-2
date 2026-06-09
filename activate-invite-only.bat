@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ===============================================
echo    Activating invite-only signup protection
echo ===============================================
echo.
echo [Step 1 of 3] Firebase login
echo A browser window will open - sign in with the Google
echo account that owns the project (finance-machine-a36e9).
echo.
call firebase login
echo.
echo [Step 2 of 3] Deploying the blocking function...
echo (If asked to enable APIs, type  Y  and press Enter. Takes a few minutes.)
echo.
call firebase deploy --only functions --project finance-machine-a36e9
echo.
echo [Step 3 of 3] Adding existing users to the allowlist...
echo.
call npx tsx scripts/seed-allowlist.ts
echo.
echo ===============================================
echo    Finished. Check the messages above:
echo      - look for  "Deploy complete!"
echo      - and the line about existing emails approved.
echo    If you see red ERROR lines, screenshot this window.
echo ===============================================
echo.
pause
