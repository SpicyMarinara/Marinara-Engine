@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0\.."
title Marinara Engine - Installer
color 0A

:: -- Safety net: if anything goes catastrophically wrong, the window stays open --
:: -- This label is jumped to on fatal errors --
set "INSTALL_ERROR="
set "NODE_DOWNLOAD_URL=https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi"
set "NODE_SHA256=2c0cc97ec64c1e4111362e1e32e0547fd870e4d9c79ec844c117da583f21b386"
set "GIT_DOWNLOAD_URL=https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe"
set "GIT_SHA256=25527923debc06515b3016f2d6bca0820656e8281a23be2f43bfb658bd5dda70"
set "RELEASE_TAG=v1.5.7"
set "RELEASE_COMMIT=159f5a2017ae958b737a7b618f5cd1a283603073"

echo.
echo  +==========================================+
echo  ^|   Marinara Engine - Windows Installer     ^|
echo  ^|   v1.5.7                                  ^|

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
powershell -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%NODE_DOWNLOAD_URL%' -OutFile '%NODE_MSI%' -UseBasicParsing } catch { exit 1 }"
if errorlevel 1 (
    set "INSTALL_ERROR=Failed to download Node.js. Please install manually from https://nodejs.org"
    goto :fatal
)
call :verify_file_hash "%NODE_MSI%" "%NODE_SHA256%" "Node.js installer"
if errorlevel 1 (
    del "%NODE_MSI%" 2>nul
    set "INSTALL_ERROR=Downloaded Node.js installer failed integrity verification."
    goto :fatal
)
call :verify_authenticode "%NODE_MSI%" "Node.js installer"
if errorlevel 1 (
    del "%NODE_MSI%" 2>nul
    set "INSTALL_ERROR=Downloaded Node.js installer has an invalid Authenticode signature."
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
powershell -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%GIT_DOWNLOAD_URL%' -OutFile '%GIT_EXE%' -UseBasicParsing } catch { exit 1 }"
if errorlevel 1 (
    set "INSTALL_ERROR=Failed to download Git. Please install manually from https://git-scm.com"
    goto :fatal
)
call :verify_file_hash "%GIT_EXE%" "%GIT_SHA256%" "Git installer"
if errorlevel 1 (
    del "%GIT_EXE%" 2>nul
    set "INSTALL_ERROR=Downloaded Git installer failed integrity verification."
    goto :fatal
)
call :verify_authenticode "%GIT_EXE%" "Git installer"
if errorlevel 1 (
    del "%GIT_EXE%" 2>nul
    set "INSTALL_ERROR=Downloaded Git installer has an invalid Authenticode signature."
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
    set "INSTALL_ERROR=Failed to start pinned pnpm %PNPM_VERSION%. Enable Corepack or install matching pnpm before running the installer."
    goto :fatal
)

:pnpm_ok
echo  [OK] pnpm !CURRENT_PNPM_VERSION! ready

:: -- Clone repository --
echo.
if exist "%INSTALL_DIR%\.git" goto :update_repo
echo  [..] Cloning Marinara Engine to %INSTALL_DIR%...
git clone --branch "%RELEASE_TAG%" --depth 1 https://github.com/Pasta-Devs/Marinara-Engine.git "%INSTALL_DIR%"
if errorlevel 1 (
    set "INSTALL_ERROR=Failed to clone release %RELEASE_TAG%. Check your internet connection and try again."
    goto :fatal
)
cd /d "%INSTALL_DIR%"
set "NEW_HEAD="
for /f "tokens=*" %%i in ('git rev-parse HEAD 2^>nul') do set "NEW_HEAD=%%i"
if /I not "!NEW_HEAD!"=="%RELEASE_COMMIT%" (
    set "INSTALL_ERROR=Downloaded release %RELEASE_TAG% did not match the expected commit."
    goto :fatal
)
goto :deps

:update_repo
echo  [..] Existing installation found, updating to %RELEASE_TAG%...
cd /d "%INSTALL_DIR%"
set "OLD_HEAD="
set "TARGET_HEAD="
set "NEW_HEAD="
for /f "tokens=*" %%i in ('git rev-parse HEAD 2^>nul') do set "OLD_HEAD=%%i"
git fetch --quiet --tags origin "%RELEASE_TAG%"
if errorlevel 1 (
    set "INSTALL_ERROR=Failed to fetch release %RELEASE_TAG%."
    goto :fatal
)
for /f "tokens=*" %%i in ('git rev-parse "%RELEASE_TAG%^{commit}" 2^>nul') do set "TARGET_HEAD=%%i"
if not defined TARGET_HEAD (
    set "INSTALL_ERROR=Could not resolve release %RELEASE_TAG% after fetch."
    goto :fatal
)
if /I not "!TARGET_HEAD!"=="%RELEASE_COMMIT%" (
    set "INSTALL_ERROR=Release %RELEASE_TAG% resolved to an unexpected commit."
    goto :fatal
)
if /I "!OLD_HEAD!"=="!TARGET_HEAD!" (
    echo  [OK] Repository already up to date
    goto :deps
)

set "STASHED=0"
set "STASH_REF="
set "DIRTY=0"
git diff --quiet >nul 2>&1
if errorlevel 1 set "DIRTY=1"
git diff --cached --quiet >nul 2>&1
if errorlevel 1 set "DIRTY=1"
if "!DIRTY!"=="1" (
    git stash push -q -m "installer auto-stash before update" >nul 2>&1 && set "STASHED=1"
    if "!STASHED!"=="1" for /f "tokens=*" %%i in ('git stash list -1 --format^=%%gd 2^>nul') do set "STASH_REF=%%i"
)

git checkout --detach "%RELEASE_COMMIT%"
if errorlevel 1 (
    if "!STASHED!"=="1" call :restore_stashed_changes
    set "INSTALL_ERROR=Failed to check out release %RELEASE_TAG%."
    goto :fatal
)
for /f "tokens=*" %%i in ('git rev-parse HEAD 2^>nul') do set "NEW_HEAD=%%i"
if /I not "!NEW_HEAD!"=="%RELEASE_COMMIT%" (
    if "!STASHED!"=="1" call :restore_stashed_changes
    set "INSTALL_ERROR=Repository update did not land on the expected %RELEASE_TAG% commit."
    goto :fatal
)
if "!STASHED!"=="1" call :restore_stashed_changes
echo  [OK] Repository updated

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
    echo oLink.IconLocation = "%INSTALL_DIR%\win\installer\app-icon.ico,0"
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
    call pnpm %*
)
exit /b %errorlevel%

:verify_file_hash
set "HASH_PATH=%~1"
set "EXPECTED_HASH=%~2"
set "HASH_LABEL=%~3"
set "ACTUAL_HASH="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "try { ((Get-FileHash -Algorithm SHA256 -LiteralPath '%HASH_PATH%').Hash).ToLowerInvariant() } catch { exit 1 }"`) do set "ACTUAL_HASH=%%i"
if not defined ACTUAL_HASH (
    echo  [ERROR] Could not calculate SHA-256 for %HASH_LABEL%.
    exit /b 1
)
if /I not "%ACTUAL_HASH%"=="%EXPECTED_HASH%" (
    echo  [ERROR] %HASH_LABEL% SHA-256 mismatch.
    exit /b 1
)
exit /b 0

:verify_authenticode
set "SIGN_PATH=%~1"
set "SIGN_LABEL=%~2"
powershell -NoProfile -Command "try { $sig = Get-AuthenticodeSignature -LiteralPath '%SIGN_PATH%'; if ($sig.Status -ne 'Valid') { Write-Error ('Invalid signature: ' + $sig.Status); exit 1 } } catch { exit 1 }"
if errorlevel 1 (
    echo  [ERROR] %SIGN_LABEL% Authenticode signature is invalid.
    exit /b 1
)
exit /b 0

:restore_stashed_changes
if not "!STASHED!"=="1" goto :eof
if "!STASH_REF!"=="" goto :eof
git stash apply -q "!STASH_REF!" >nul 2>&1
if errorlevel 1 (
    echo  [WARN] Could not reapply local changes cleanly.
    echo         Your changes are preserved in !STASH_REF!.
    echo         Reapply them manually after installation if needed.
    git reset --hard HEAD >nul 2>&1
    goto :eof
)
git stash drop -q "!STASH_REF!" >nul 2>&1
goto :eof

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
