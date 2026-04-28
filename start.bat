@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
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

:: Resolve the repo-pinned pnpm version from package.json
set "PNPM_VERSION=10.30.3"
for /f "usebackq delims=" %%i in (`node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).packageManager?.split('@')[1] || '10.30.3'"`) do set "PNPM_VERSION=%%i"
set "PNPM_RUNNER=pnpm"
set "CURRENT_PNPM_VERSION="

:: Ensure pnpm is available before any update/install path uses it
where corepack >nul 2>&1
if not errorlevel 1 (
    echo  [..] Aligning pnpm to %PNPM_VERSION% via Corepack...
    for /f "usebackq delims=" %%i in (`corepack pnpm@%PNPM_VERSION% --version 2^>nul`) do set "CURRENT_PNPM_VERSION=%%i"
    if /I "!CURRENT_PNPM_VERSION!"=="%PNPM_VERSION%" (
        set "PNPM_RUNNER=corepack"
    ) else (
        set "CURRENT_PNPM_VERSION="
    )
)

if not defined CURRENT_PNPM_VERSION (
    where pnpm >nul 2>&1
    if not errorlevel 1 (
        for /f "usebackq delims=" %%i in (`pnpm --version 2^>nul`) do set "CURRENT_PNPM_VERSION=%%i"
        if /I not "!CURRENT_PNPM_VERSION!"=="%PNPM_VERSION%" (
            set "CURRENT_PNPM_VERSION="
        )
    )
)

if not defined CURRENT_PNPM_VERSION (
    echo  [..] Using temporary pnpm %PNPM_VERSION% via npx...
    for /f "usebackq delims=" %%i in (`npx --yes pnpm@%PNPM_VERSION% --version 2^>nul`) do set "CURRENT_PNPM_VERSION=%%i"
    if /I "!CURRENT_PNPM_VERSION!"=="%PNPM_VERSION%" (
        set "PNPM_RUNNER=npx"
    ) else (
        set "CURRENT_PNPM_VERSION="
    )
)

if not defined CURRENT_PNPM_VERSION (
    echo  [ERROR] Failed to make pnpm %PNPM_VERSION% available.
    pause
    exit /b 1
)

goto :after_restore_helper

:restore_stashed_changes
if not "!STASHED!"=="1" goto :eof
if "!STASH_REF!"=="" goto :eof
git stash apply -q "!STASH_REF!" >nul 2>&1
if errorlevel 1 (
    echo  [WARN] Auto-update could not reapply your local changes cleanly.
    echo         Your changes are preserved in !STASH_REF!.
    echo         Review them with: git stash show -p !STASH_REF!
    echo         Reapply them manually with: git stash pop !STASH_REF!
    git reset --hard HEAD >nul 2>&1
    goto :eof
)
git stash drop -q "!STASH_REF!" >nul 2>&1
goto :eof

:after_restore_helper

:: Auto-update from Git
if not exist ".git" goto :skip_update
echo  [..] Checking for updates...
for /f "tokens=*" %%i in ('git rev-parse HEAD 2^>nul') do set "OLD_HEAD=%%i"
git fetch origin main --quiet >nul 2>&1
if errorlevel 1 (
    echo  [WARN] Could not check for updates. Continuing with current version.
    goto :skip_update
)
for /f "tokens=*" %%i in ('git rev-parse origin/main 2^>nul') do set "TARGET_HEAD=%%i"
if /I "!OLD_HEAD!"=="!TARGET_HEAD!" (
    echo  [OK] Already up to date
    goto :skip_update
)
:: Drop known-safe untracked files that older installer versions placed in
:: $INSTDIR but are now also tracked in the repo. Without this, git merge
:: --ff-only refuses to overwrite them and the auto-update silently fails.
:: The repo copies are byte-identical to what the installer wrote, so this
:: is non-destructive — git restores them as tracked files after the merge.
if exist "app-icon.ico" (
    git ls-files --error-unmatch "app-icon.ico" >nul 2>&1
    if errorlevel 1 del /q "app-icon.ico" >nul 2>&1
)

:: Stash any tracked local changes so the fast-forward update doesn't fail
set "STASHED=0"
set "STASH_REF="
set "DIRTY=0"
git diff --quiet >nul 2>&1
if errorlevel 1 set "DIRTY=1"
git diff --cached --quiet >nul 2>&1
if errorlevel 1 set "DIRTY=1"
if "!DIRTY!"=="1" (
    git stash push -q -m "auto-stash before update" >nul 2>&1 && set "STASHED=1"
    if "!STASHED!"=="1" for /f "tokens=*" %%i in ('git stash list -1 --format^=%%gd 2^>nul') do set "STASH_REF=%%i"
)
git merge --ff-only origin/main >nul 2>&1
if errorlevel 1 (
    if "!STASHED!"=="1" call :restore_stashed_changes
    echo  [WARN] Could not fast-forward to origin/main. Continuing with current version.
    goto :skip_update
)
for /f "tokens=*" %%i in ('git rev-parse HEAD 2^>nul') do set "NEW_HEAD=%%i"
if /I not "!NEW_HEAD!"=="!TARGET_HEAD!" (
    if "!STASHED!"=="1" call :restore_stashed_changes
    echo  [WARN] Update did not land on origin/main. Continuing with current version.
    goto :skip_update
)
if "!STASHED!"=="1" call :restore_stashed_changes
echo  [OK] Updated to latest version
echo  [..] Reinstalling dependencies...
call :run_pnpm install
if exist "packages\shared\dist" rmdir /s /q "packages\shared\dist"
if exist "packages\server\dist" rmdir /s /q "packages\server\dist"
if exist "packages\client\dist" rmdir /s /q "packages\client\dist"
del /q "packages\shared\tsconfig.tsbuildinfo" 2>nul
del /q "packages\server\tsconfig.tsbuildinfo" 2>nul
del /q "packages\client\tsconfig.tsbuildinfo" 2>nul

:skip_update
echo  [OK] Node.js found:
node -v
echo  [OK] pnpm !CURRENT_PNPM_VERSION! ready

:: Detect stale dist (source updated but dist not rebuilt)
if not exist "packages\shared\dist\constants\defaults.js" goto :skip_version_check
for /f "usebackq delims=" %%i in (`node -p "require('./package.json').version" 2^>nul`) do set "SOURCE_VER=%%i"
for /f "usebackq delims=" %%i in (`node -e "try{const m=require('./packages/shared/dist/constants/defaults.js');console.log(m.APP_VERSION)}catch{}" 2^>nul`) do set "DIST_VER=%%i"
for /f "usebackq delims=" %%i in (`git rev-parse --short=12 HEAD 2^>nul`) do set "SOURCE_COMMIT=%%i"
for /f "usebackq delims=" %%i in (`node -e "try{const m=require('./packages/server/dist/config/build-meta.json');console.log(m.commit || '')}catch{}" 2^>nul`) do set "DIST_COMMIT=%%i"
if not "!SOURCE_VER!"=="" if not "!DIST_VER!"=="" if not "!SOURCE_VER!"=="!DIST_VER!" (
    echo  [WARN] Version mismatch: source v!SOURCE_VER! but dist has v!DIST_VER!
    echo  [..] Forcing rebuild to apply update...
    call :run_pnpm install
    if exist "packages\shared\dist" rmdir /s /q "packages\shared\dist"
    if exist "packages\server\dist" rmdir /s /q "packages\server\dist"
    if exist "packages\client\dist" rmdir /s /q "packages\client\dist"
    del /q "packages\shared\tsconfig.tsbuildinfo" 2>nul
    del /q "packages\server\tsconfig.tsbuildinfo" 2>nul
    del /q "packages\client\tsconfig.tsbuildinfo" 2>nul
)
if not "!SOURCE_COMMIT!"=="" if /I not "!SOURCE_COMMIT!"=="!DIST_COMMIT!" (
    echo  [WARN] Build commit mismatch: source !SOURCE_COMMIT! but dist has !DIST_COMMIT!
    echo  [..] Forcing rebuild to apply update...
    call :run_pnpm install
    if exist "packages\shared\dist" rmdir /s /q "packages\shared\dist"
    if exist "packages\server\dist" rmdir /s /q "packages\server\dist"
    if exist "packages\client\dist" rmdir /s /q "packages\client\dist"
    del /q "packages\shared\tsconfig.tsbuildinfo" 2>nul
    del /q "packages\server\tsconfig.tsbuildinfo" 2>nul
    del /q "packages\client\tsconfig.tsbuildinfo" 2>nul
)
:skip_version_check

:: Install dependencies if needed
if exist "node_modules" goto :skip_install
echo.
echo  [..] Installing dependencies (first run)...
echo      This may take a few minutes.
echo.
call :run_pnpm install
if errorlevel 1 echo  [ERROR] Failed to install dependencies. & pause & exit /b 1

:skip_install

:: Build if needed
if not exist "packages\shared\dist" (
    echo  [..] Building shared types...
    call :run_pnpm --filter @marinara-engine/shared build
    if errorlevel 1 echo  [ERROR] Failed to build shared types. & pause & exit /b 1
)
if not exist "packages\server\dist" (
    echo  [..] Building server...
    call :run_pnpm --filter @marinara-engine/server build
    if errorlevel 1 echo  [ERROR] Failed to build the server. & pause & exit /b 1
)
if not exist "packages\client\dist" (
    echo  [..] Building client...
    call :run_pnpm --filter @marinara-engine/client build
    if errorlevel 1 echo  [ERROR] Failed to build the client. & pause & exit /b 1
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
echo    Starting Marinara Engine on %PROTOCOL%://127.0.0.1:%PORT%
echo    Press Ctrl+C to stop
echo  ==========================================
echo.

:: Open browser after a short delay (use explorer.exe as fallback)
if defined AUTO_OPEN_BROWSER_ENABLED (
    start "" cmd /c "timeout /t 4 /nobreak >nul && start %PROTOCOL%://127.0.0.1:%PORT% || explorer %PROTOCOL%://127.0.0.1:%PORT%"
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
goto :eof

:run_pnpm
if /I "%PNPM_RUNNER%"=="corepack" (
    call corepack pnpm@%PNPM_VERSION% %*
) else (
    if /I "%PNPM_RUNNER%"=="npx" (
        call npx --yes pnpm@%PNPM_VERSION% %*
    ) else (
        call pnpm %*
    )
)
exit /b %errorlevel%
