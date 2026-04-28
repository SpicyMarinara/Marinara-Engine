@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0\.."
title Marinara Engine - Installer
color 0A

:: -- Safety net: if anything goes catastrophically wrong, the window stays open --
:: -- This label is jumped to on fatal errors --
set "INSTALL_ERROR="

echo.
echo  +==========================================+
echo  ^|   Marinara Engine - Windows Installer     ^|
echo  ^|   v1.5.5                                  ^|

echo  +==========================================+
echo.

:: -- Verify script is running --
echo  [OK] Installer started successfully
echo.

:: -- Choose install location --
set "INSTALL_DIR=%USERPROFILE%\Marinara-Engine"
set "USER_INPUT="
set /p "USER_INPUT=  Install location [%INSTALL_DIR%]: "
if not "%USER_INPUT%"=="" set "INSTALL_DIR=%USER_INPUT%"

:: -- Check prerequisites --
echo.
echo  [..] Checking prerequisites...

:: -- Node.js --
where node >nul 2>&1
if errorlevel 1 goto :install_node
for /f "tokens=1 delims=." %%a in ('node -v') do set "NODE_RAW=%%a"
set "NODE_MAJOR=!NODE_RAW:v=!"
if not defined NODE_MAJOR goto :install_node
if !NODE_MAJOR! LSS 20 goto :install_node
goto :node_ok

:install_node
echo  [..] Node.js 20+ not found - downloading installer...
set "NODE_MSI=%TEMP%\node-lts-install.msi"
powershell -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi' -OutFile '%NODE_MSI%' -UseBasicParsing } catch { exit 1 }"
if errorlevel 1 (
    set "INSTALL_ERROR=Failed to download Node.js. Please install manually from https://nodejs.org"
    goto :fatal
)
echo  [..] Installing Node.js (this may request admin permissions)...
msiexec /i "%NODE_MSI%" /qb
if errorlevel 1 (
    set "INSTALL_ERROR=Node.js installation failed. Please install manually from https://nodejs.org"
    goto :fatal
)
del "%NODE_MSI%" 2>nul
call :refresh_path
where node >nul 2>&1
if errorlevel 1 (
    set "INSTALL_ERROR=Node.js installed but not found in PATH. Please restart your computer and re-run the installer."
    goto :fatal
)
echo  [OK] Node.js installed successfully

:node_ok
echo  [OK] Node.js found:
node -v

set "PNPM_VERSION=10.30.3"
for /f "usebackq delims=" %%i in (`node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).packageManager?.split('@')[1] || '10.30.3'"`) do set "PNPM_VERSION=%%i"
set "PNPM_RUNNER=pnpm"
set "CURRENT_PNPM_VERSION="

:: -- Git --
where git >nul 2>&1
if errorlevel 1 goto :install_git
goto :git_ok

:install_git
echo  [..] Git not found - downloading installer...
set "GIT_EXE=%TEMP%\git-install.exe"
set "GIT_DOWNLOAD_URL=https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe"
powershell -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%GIT_DOWNLOAD_URL%' -OutFile '%GIT_EXE%' -UseBasicParsing } catch { exit 1 }"
if errorlevel 1 (
    set "INSTALL_ERROR=Failed to download Git. Please install manually from https://git-scm.com"
    goto :fatal
)
echo  [..] Installing Git (this may request admin permissions)...
"%GIT_EXE%" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"
if errorlevel 1 (
    set "INSTALL_ERROR=Git installation failed. Please install manually from https://git-scm.com"
    goto :fatal
)
del "%GIT_EXE%" 2>nul
call :refresh_path
where git >nul 2>&1
if errorlevel 1 (
    set "INSTALL_ERROR=Git installed but not found in PATH. Please restart your computer and re-run the installer."
    goto :fatal
)
echo  [OK] Git installed successfully

:git_ok
echo  [OK] Git found

:: -- Resolve pinned pnpm without changing global state --
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
    set "INSTALL_ERROR=Failed to start pnpm %PNPM_VERSION% via Corepack or npx."
    goto :fatal
)

:pnpm_ok
echo  [OK] pnpm !CURRENT_PNPM_VERSION! ready

:: -- Clone repository --
echo.
if exist "%INSTALL_DIR%\.git" goto :update_repo
echo  [..] Cloning Marinara Engine to %INSTALL_DIR%...
git clone https://github.com/Pasta-Devs/Marinara-Engine.git "%INSTALL_DIR%"
if errorlevel 1 (
    set "INSTALL_ERROR=Failed to clone repository. Check your internet connection and try again."
    goto :fatal
)
cd /d "%INSTALL_DIR%"
goto :deps

:update_repo
echo  [..] Existing installation found, updating...
cd /d "%INSTALL_DIR%"
git pull

:deps

:: -- Install dependencies --
echo.
echo  [..] Installing dependencies (this may take a few minutes)...
call :run_pnpm install
if %errorlevel% neq 0 (
    set "INSTALL_ERROR=Failed to install dependencies."
    goto :fatal
)
echo  [OK] Dependencies installed

:: -- Build --
echo.
echo  [..] Building Marinara Engine...
call :run_pnpm --filter @marinara-engine/shared build
if %errorlevel% neq 0 (
    set "INSTALL_ERROR=Shared package build failed."
    goto :fatal
)
call :run_pnpm --filter @marinara-engine/server --filter @marinara-engine/client --parallel run build
if %errorlevel% neq 0 (
    set "INSTALL_ERROR=Server or client build failed."
    goto :fatal
)
echo  [OK] Build complete

:: -- Sync database --
echo  [..] Setting up database...
call :run_pnpm --filter @marinara-engine/server db:push 2>nul
echo  [OK] Database ready

:: -- Create desktop shortcut --
echo  [..] Creating desktop shortcut...
set "SHORTCUT=%USERPROFILE%\Desktop\Marinara Engine.lnk"
set "VBS=%TEMP%\create_shortcut.vbs"

(
    echo Set oWS = WScript.CreateObject^("WScript.Shell"^)
    echo sLinkFile = "%SHORTCUT%"
    echo Set oLink = oWS.CreateShortcut^(sLinkFile^)
    echo oLink.TargetPath = "%INSTALL_DIR%\start.bat"
    echo oLink.WorkingDirectory = "%INSTALL_DIR%"
    echo oLink.IconLocation = "%INSTALL_DIR%\installer\app-icon.ico,0"
    echo oLink.Description = "Marinara Engine - AI Chat ^& Roleplay"
    echo oLink.Save
) > "%VBS%"
cscript //nologo "%VBS%"
del "%VBS%"
echo  [OK] Desktop shortcut created

:: -- Done --
echo.
echo  ==========================================
echo    Installation complete!
echo.
echo    To start: double-click "Marinara Engine"
echo    on your Desktop, or run start.bat in:
echo    %INSTALL_DIR%
echo.
echo    The app opens in your browser at the configured local URL.
echo    Default:
echo    http://127.0.0.1:7860
echo  ==========================================
echo.
pause
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

:: -- Fatal error handler: always visible, never silent --
:fatal
echo.
echo  ==========================================
echo    [ERROR] !INSTALL_ERROR!
echo  ==========================================
echo.
echo  The installer could not complete.
echo  Please screenshot this window and report
echo  the issue if you need help.
echo.
pause
exit /b 1

:: -- Subroutine: refresh PATH from registry --
:refresh_path
for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USR_PATH=%%B"
set "PATH=!SYS_PATH!;!USR_PATH!"
goto :eof
goto :eof
