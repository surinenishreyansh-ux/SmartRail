@echo off
title SmartRail Railway Intelligence Dashboard
echo ========================================================
echo   SmartRail - Real Hardware Railway Intelligence Center
echo ========================================================
echo.
echo Starting SmartRail Dashboard...
cd SmartRail
if not exist node_modules (
    echo [INFO] Installing frontend dependencies...
    npm install
)
echo.
echo [INFO] Launching Vite Dev Server...
npm run dev
pause
