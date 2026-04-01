@echo off
setlocal enabledelayedexpansion
title Marinara Engine
color 0A
echo.
echo  +==========================================+
echo  ^|       Marinara Engine  -  Launcher        ^|
echo  +==========================================+
echo.

:: Check for Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js is not installed or not in PATH.
    echo  Please install Node.js 20+ from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Auto-update from Git
if not exist ".git" goto :skip_update
echo  [..] Checking for updates...
for /f "tokens=*" %%i in ('git rev-parse HEAD 2^>nul') do set "OLD_HEAD=%%i"
git pull >nul 2>&1
if errorlevel 1 (
    echo  [WARN] Could not check for updates. Continuing with current version.
    goto :skip_update
)
for /f "tokens=*" %%i in ('git rev-parse HEAD 2^>nul') do set "NEW_HEAD=%%i"
if "!OLD_HEAD!"=="!NEW_HEAD!" (
    echo  [OK] Already up to date
    goto :skip_update
)
echo  [OK] Updated to latest version
echo  [..] Reinstalling dependencies...
call pnpm install
if exist "packages\shared\dist" rmdir /s /q "packages\shared\dist"
if exist "packages\server\dist" rmdir /s /q "packages\server\dist"
if exist "packages\client\dist" rmdir /s /q "packages\client\dist"
del /q "packages\shared\tsconfig.tsbuildinfo" 2>nul
del /q "packages\server\tsconfig.tsbuildinfo" 2>nul
del /q "packages\client\tsconfig.tsbuildinfo" 2>nul

:skip_update
echo  [OK] Node.js found:
node -v

:: Check for pnpm
where pnpm >nul 2>&1
if errorlevel 1 (
    echo  [..] pnpm not found, installing via corepack...
    corepack enable
    corepack prepare pnpm@latest --activate
)
echo  [OK] pnpm found

:: Install dependencies if needed
if exist "node_modules" goto :skip_install
echo.
echo  [..] Installing dependencies (first run)...
echo      This may take a few minutes.
echo.
call pnpm install
if errorlevel 1 echo  [ERROR] Failed to install dependencies. & pause & exit /b 1

:skip_install

:: Build if needed
if not exist "packages\shared\dist" (
    echo  [..] Building shared types...
    call pnpm build:shared
)
if not exist "packages\server\dist" (
    echo  [..] Building server...
    call pnpm build:server
)
if not exist "packages\client\dist" (
    echo  [..] Building client...
    call pnpm build:client
)

:: Database migrations are handled automatically at server startup by runMigrations()

:: Load .env if present (respects user overrides)
if not exist .env goto :skip_env
for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" if not "%%B"=="" set "%%A=%%B"
)

:skip_env
:: Set defaults only if not already set
set NODE_ENV=production
if not defined PORT set PORT=7860
if not defined HOST set HOST=0.0.0.0

set PROTOCOL=http
if defined SSL_CERT if defined SSL_KEY set PROTOCOL=https

set "AUTO_OPEN_BROWSER_ENABLED=1"
if defined AUTO_OPEN_BROWSER (
    if /I "%AUTO_OPEN_BROWSER%"=="0" set "AUTO_OPEN_BROWSER_ENABLED="
    if /I "%AUTO_OPEN_BROWSER%"=="false" set "AUTO_OPEN_BROWSER_ENABLED="
    if /I "%AUTO_OPEN_BROWSER%"=="no" set "AUTO_OPEN_BROWSER_ENABLED="
    if /I "%AUTO_OPEN_BROWSER%"=="off" set "AUTO_OPEN_BROWSER_ENABLED="
)

echo.
echo  ==========================================
echo    Starting Marinara Engine on %PROTOCOL%://localhost:%PORT%
echo    Press Ctrl+C to stop
echo  ==========================================
echo.

:: Open browser after a short delay (use explorer.exe as fallback)
if defined AUTO_OPEN_BROWSER_ENABLED (
    start "" cmd /c "timeout /t 4 /nobreak >nul && start %PROTOCOL%://localhost:%PORT% || explorer %PROTOCOL%://localhost:%PORT%"
) else (
    echo  [OK] Auto-open disabled ^(AUTO_OPEN_BROWSER=%AUTO_OPEN_BROWSER%^)
)

:: Start server
cd packages\server
node dist/index.js
if errorlevel 1 (
    echo.
    echo  [ERROR] Server exited unexpectedly. See the error above.
    echo.
    pause
)
