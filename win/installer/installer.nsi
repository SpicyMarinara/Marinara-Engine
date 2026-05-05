; ──────────────────────────────────────────────
; Marinara Engine — Windows Installer
; Cross-compiled from macOS via NSIS (makensis)
; ──────────────────────────────────────────────

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WinMessages.nsh"

!insertmacro GetParent

; ── App metadata ──
!define APP_NAME "Marinara Engine"
!define APP_VERSION "1.5.7"
!define APP_PUBLISHER "Pasta-Devs"
!define APP_URL "https://github.com/Pasta-Devs/Marinara-Engine"
!define REPO_URL "https://github.com/Pasta-Devs/Marinara-Engine.git"
!define DEFAULT_DIR "$LOCALAPPDATA\MarinaraEngine"
!define PNPM_VERSION "10.33.2"

; ── Prerequisite download URLs ──
; Pin to known-good versions so the installer is deterministic and doesn't
; need PowerShell/GitHub API calls (a major AV false-positive trigger).
!define GIT_DOWNLOAD_URL "https://github.com/git-for-windows/git/releases/download/v2.54.0.windows.1/Git-2.54.0-64-bit.exe"
!define NODE_DOWNLOAD_URL "https://nodejs.org/dist/v24.15.0/node-v24.15.0-x64.msi"
!define GIT_SHA256 "2b96e7854f0520f0f6b709c21041d9801b1be44d5e1a0d9fa621b2fbc40f1983"
!define NODE_SHA256 "feffb8e5cb5ac47f793666636d496ef3e975be82c84c4da5d20e6aa8fa4eb806"
!define RELEASE_TAG "v1.5.7"
!ifndef RELEASE_COMMIT
!define RELEASE_COMMIT ""
!endif

Name "${APP_NAME}"
OutFile "Marinara-Engine-Installer-${APP_VERSION}.exe"
InstallDir "${DEFAULT_DIR}"
InstallDirRegKey HKCU "Software\${APP_NAME}" "InstallDir"
RequestExecutionLevel user
Unicode True
SetCompressor /SOLID lzma
ShowInstDetails show

; ── Modern UI config ──
!define MUI_ICON "app-icon.ico"
!define MUI_UNICON "app-icon.ico"
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "Are you sure you want to cancel ${APP_NAME} installation?"
BrandingText "${APP_NAME} v${APP_VERSION} — AI Chat & Roleplay Engine"

; ── Header image (150x57 banner shown on every page) ──
; Uncomment if you create installer/header.bmp:
; !define MUI_HEADERIMAGE
; !define MUI_HEADERIMAGE_BITMAP "header.bmp"
; !define MUI_HEADERIMAGE_RIGHT

; ── Welcome page ──
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT "\
${APP_NAME} is a local AI chat and roleplay engine that runs entirely on your machine.$\r$\n$\r$\n\
This installer will:$\r$\n\
  - Check for Node.js and Git (and help you install them)$\r$\n\
  - Align pnpm to the repo-pinned version so older global installs do not break setup$\r$\n\
  - Download the latest ${APP_NAME} files$\r$\n\
  - Install dependencies and build the app$\r$\n\
  - Create shortcuts so you can launch it anytime$\r$\n$\r$\n\
After installation, ${APP_NAME} will auto-update itself via Settings > Check for Updates.$\r$\n$\r$\n\
Click Next to continue."

; ── Directory page ──
!define MUI_DIRECTORYPAGE_TEXT_TOP "\
Choose where to install ${APP_NAME}. About 500 MB of free space is recommended.$\r$\n$\r$\n\
Your chats, characters, and data will be stored inside this folder."

; ── Finish page ──
!define MUI_FINISHPAGE_TITLE "Installation Complete!"
!define MUI_FINISHPAGE_TEXT "\
${APP_NAME} has been installed successfully.$\r$\n$\r$\n\
To start the app, double-click the desktop shortcut or select the option below.$\r$\n\
It will open automatically in your browser at http://127.0.0.1:7860$\r$\n$\r$\n\
Future updates: Open Settings in the app and click $\"Check for Updates$\"."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchApp"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APP_NAME} now"
!define MUI_FINISHPAGE_LINK "Visit ${APP_NAME} on GitHub"
!define MUI_FINISHPAGE_LINK_LOCATION "${APP_URL}"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

; ── Pages ──
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

; ── Variables ──
Var GIT_OK
Var NODE_OK
Var PNPM_OK
Var PNPM_RUNNER
Var CLONE_DIR
Var CLONE_DIR_CREATED
Var STAGE_DIR
Var STAGE_DIR_CREATED
Var STAGE_PARENT

Function LaunchApp
  ExecShell "" "$INSTDIR\start.bat"
FunctionEnd

Function CreateAppShortcut
  Exch $0
  FileOpen $1 "$TEMP\me-create-shortcut.vbs" w
  FileWrite $1 'Set oWS = WScript.CreateObject("WScript.Shell")$\r$\n'
  FileWrite $1 'Set oLink = oWS.CreateShortcut("$0")$\r$\n'
  FileWrite $1 'oLink.TargetPath = "$INSTDIR\start.bat"$\r$\n'
  FileWrite $1 'oLink.WorkingDirectory = "$INSTDIR"$\r$\n'
  FileWrite $1 'oLink.IconLocation = "$INSTDIR\app-icon.ico,0"$\r$\n'
  FileWrite $1 'oLink.Description = "${APP_NAME} - AI Chat & Roleplay"$\r$\n'
  FileWrite $1 'oLink.Save$\r$\n'
  FileClose $1
  nsExec::ExecToLog '"$SYSDIR\cscript.exe" //nologo "$TEMP\me-create-shortcut.vbs"'
  Pop $1
  Delete "$TEMP\me-create-shortcut.vbs"
FunctionEnd

; ──────────────────────────────────────────────
; Install Section
; ──────────────────────────────────────────────
Section "Install" SecInstall
  SetOutPath "$INSTDIR"
  SetDetailsPrint both

  ; ── Step 1: Check for Git ──
  DetailPrint ""
  DetailPrint "═══ Step 1/6: Checking prerequisites ═══"
  DetailPrint ""
  DetailPrint "Looking for Git..."
  nsExec::ExecToStack 'where git'
  Pop $GIT_OK
  Pop $1 ; discard stdout
  ${If} $GIT_OK != 0
    DetailPrint "Git not found — attempting automatic install..."
    DetailPrint "Downloading Git for Windows (this may take a minute)..."
    ; Download Git installer via PowerShell (known-working path used by the v1.4.7 installer)
    nsExec::ExecToLog 'cmd /c powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri ""${GIT_DOWNLOAD_URL}"" -OutFile ""$TEMP\git-install.exe"" -UseBasicParsing"'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_YESNO|MB_ICONEXCLAMATION "\
Git could not be downloaded automatically.$\r$\n$\r$\n\
Would you like to open the Git download page to install it manually?" IDYES openGit IDNO abortGit
      openGit:
        ExecShell "open" "https://git-scm.com/download/win"
        MessageBox MB_OK "Please install Git, then run this installer again."
        Abort
      abortGit:
        Abort "Installation cancelled — Git is required."
    ${EndIf}
    DetailPrint "Verifying Git installer integrity..."
    nsExec::ExecToLog 'cmd /c powershell -NoProfile -Command "if (((Get-FileHash -Algorithm SHA256 -LiteralPath ""$TEMP\git-install.exe"").Hash).ToLowerInvariant() -ne ''${GIT_SHA256}'') { exit 1 }; if ((Get-AuthenticodeSignature -LiteralPath ""$TEMP\git-install.exe"").Status -ne ''Valid'') { exit 1 }"'
    Pop $0
    ${If} $0 != 0
      Delete "$TEMP\git-install.exe"
      MessageBox MB_OK|MB_ICONSTOP "The downloaded Git installer failed integrity or signature verification.$\r$\n$\r$\nInstallation was stopped before running it."
      Abort
    ${EndIf}
    DetailPrint "Installing Git (this may request admin permissions)..."
    nsExec::ExecToLog '"$TEMP\git-install.exe" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"'
    Pop $0
    Delete "$TEMP\git-install.exe"
    ; Refresh PATH from registry so we can find the newly installed Git
    ReadRegStr $1 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
    ReadRegStr $2 HKCU "Environment" "Path"
    System::Call 'Kernel32::SetEnvironmentVariable(t "PATH", t "$1;$2")i'
    nsExec::ExecToStack 'where git'
    Pop $GIT_OK
    Pop $1
    ${If} $GIT_OK != 0
      MessageBox MB_OK|MB_ICONSTOP "\
Git was installed but cannot be found in PATH.$\r$\n$\r$\n\
Please restart your computer and run this installer again."
      Abort
    ${EndIf}
    DetailPrint "Git installed successfully."
  ${Else}
    DetailPrint "Git found."
  ${EndIf}

  ; ── Check for Node.js ──
  DetailPrint "Looking for Node.js..."
  nsExec::ExecToStack 'where node'
  Pop $NODE_OK
  Pop $1
  ${If} $NODE_OK == 0
    nsExec::ExecToStack 'cmd /c node -p "process.versions.node.match(/^\d+/)[0]"'
    Pop $NODE_OK
    Pop $1
    ${If} $NODE_OK != 0
      DetailPrint "Node.js was found but its version could not be checked."
    ${ElseIf} $1 < 24
      DetailPrint "Node.js $1 found — Node.js 24 LTS or newer is required."
      StrCpy $NODE_OK 1
    ${Else}
      StrCpy $NODE_OK 0
    ${EndIf}
  ${EndIf}
  ${If} $NODE_OK != 0
    DetailPrint "Node.js 24 LTS or newer not found — attempting automatic install..."
    DetailPrint "Downloading Node.js LTS (this may take a minute)..."
    nsExec::ExecToLog 'cmd /c powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri ""${NODE_DOWNLOAD_URL}"" -OutFile ""$TEMP\node-install.msi"" -UseBasicParsing"'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_YESNO|MB_ICONEXCLAMATION "\
Node.js could not be downloaded automatically.$\r$\n$\r$\n\
Would you like to open the Node.js download page to install it manually?" IDYES openNode IDNO abortNode
      openNode:
        ExecShell "open" "https://nodejs.org/en/download"
        MessageBox MB_OK "Please install Node.js 24 LTS or newer, then run this installer again."
        Abort
      abortNode:
        Abort "Installation cancelled — Node.js is required."
    ${EndIf}
    DetailPrint "Verifying Node.js installer integrity..."
    nsExec::ExecToLog 'cmd /c powershell -NoProfile -Command "if (((Get-FileHash -Algorithm SHA256 -LiteralPath ""$TEMP\node-install.msi"").Hash).ToLowerInvariant() -ne ''${NODE_SHA256}'') { exit 1 }; if ((Get-AuthenticodeSignature -LiteralPath ""$TEMP\node-install.msi"").Status -ne ''Valid'') { exit 1 }"'
    Pop $0
    ${If} $0 != 0
      Delete "$TEMP\node-install.msi"
      MessageBox MB_OK|MB_ICONSTOP "The downloaded Node.js installer failed integrity or signature verification.$\r$\n$\r$\nInstallation was stopped before running it."
      Abort
    ${EndIf}
    DetailPrint "Installing Node.js LTS (this may request admin permissions)..."
    nsExec::ExecToLog 'msiexec /i "$TEMP\node-install.msi" /qb'
    Pop $0
    Delete "$TEMP\node-install.msi"
    ; Refresh PATH
    ReadRegStr $1 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
    ReadRegStr $2 HKCU "Environment" "Path"
    System::Call 'Kernel32::SetEnvironmentVariable(t "PATH", t "$1;$2")i'
    nsExec::ExecToStack 'where node'
    Pop $NODE_OK
    Pop $1
    ${If} $NODE_OK != 0
      MessageBox MB_OK|MB_ICONSTOP "\
Node.js was installed but cannot be found in PATH.$\r$\n$\r$\n\
Please restart your computer and run this installer again."
      Abort
    ${EndIf}
    DetailPrint "Node.js installed successfully."
  ${Else}
    DetailPrint "Node.js found."
  ${EndIf}


  ; ── Check for pnpm ──
  DetailPrint "Ensuring pnpm ${PNPM_VERSION}..."
  StrCpy $PNPM_RUNNER ""
  nsExec::ExecToStack 'where corepack'
  Pop $0
  Pop $1
  ${If} $0 == 0
    DetailPrint "Trying pinned pnpm ${PNPM_VERSION} via Corepack..."
    nsExec::ExecToStack 'cmd /c corepack pnpm@${PNPM_VERSION} --version'
    Pop $PNPM_OK
    Pop $1
    ${If} $PNPM_OK == 0
      StrCpy $PNPM_RUNNER "corepack"
    ${EndIf}
  ${EndIf}
  ${If} $PNPM_RUNNER == ""
    DetailPrint "Corepack pnpm ${PNPM_VERSION} unavailable; trying installed pnpm..."
    nsExec::ExecToStack 'cmd /c pnpm --version'
    Pop $PNPM_OK
    Pop $1
    ${If} $PNPM_OK == 0
      StrCpy $PNPM_RUNNER "pnpm"
    ${EndIf}
  ${EndIf}
  ${If} $PNPM_RUNNER == ""
    DetailPrint "Installed pnpm unavailable; trying temporary pnpm ${PNPM_VERSION} via npx..."
    nsExec::ExecToStack 'cmd /c npx --yes pnpm@${PNPM_VERSION} --version'
    Pop $PNPM_OK
    Pop $1
    ${If} $PNPM_OK == 0
      StrCpy $PNPM_RUNNER "npx"
    ${EndIf}
  ${EndIf}
  ${If} $PNPM_RUNNER == ""
    MessageBox MB_OK|MB_ICONSTOP "pnpm ${PNPM_VERSION} could not be started.$\r$\n$\r$\nPlease enable Corepack or install pnpm manually, then run the installer again."
    Abort
  ${EndIf}
  DetailPrint "pnpm ready."
  DetailPrint "All prerequisites satisfied."

  ; ── Step 2: Download / update repository ──
  DetailPrint ""
  DetailPrint "═══ Step 2/6: Downloading ${APP_NAME} ═══"
  DetailPrint ""
  ${If} ${FileExists} "$INSTDIR\.git\*.*"
    DetailPrint "Existing installation found — fetching ${RELEASE_TAG}..."
    nsExec::ExecToLog 'git fetch --quiet --force origin refs/tags/${RELEASE_TAG}:refs/tags/${RELEASE_TAG}'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "Failed to fetch release ${RELEASE_TAG}.$\r$\n$\r$\nPlease check your internet connection and run the installer again."
      Abort
    ${EndIf}

    StrCpy $5 "0"
    nsExec::ExecToLog 'cmd /c git diff --quiet && git diff --cached --quiet'
    Pop $1
    ${If} $1 != 0
      DetailPrint "Local changes detected — stashing before update..."
      nsExec::ExecToLog 'git stash push -q -m "installer auto-stash before update"'
      Pop $1
      ${If} $1 == 0
        StrCpy $5 "1"
      ${Else}
        MessageBox MB_OK|MB_ICONSTOP "Failed to stash local repository changes before update.$\r$\n$\r$\nPlease resolve local changes or reinstall into a clean folder."
        Abort
      ${EndIf}
    ${EndIf}

    nsExec::ExecToStack 'git rev-parse ${RELEASE_TAG}^{commit}'
    Pop $0
    Pop $3
    ${If} $0 != 0
      ${If} $5 == "1"
        nsExec::ExecToLog 'git stash apply -q'
        Pop $1
      ${EndIf}
      MessageBox MB_OK|MB_ICONSTOP "Could not resolve release ${RELEASE_TAG} after fetching it.$\r$\n$\r$\nInstallation was stopped before updating files."
      Abort
    ${EndIf}

    ${If} $3 == ""
      ${If} $5 == "1"
        nsExec::ExecToLog 'git stash apply -q'
        Pop $1
      ${EndIf}
      MessageBox MB_OK|MB_ICONSTOP "Release ${RELEASE_TAG} resolved to an empty commit.$\r$\n$\r$\nInstallation was stopped before updating files."
      Abort
    ${EndIf}

    ${If} "${RELEASE_COMMIT}" != ""
    ${AndIf} $3 != "${RELEASE_COMMIT}"
      DetailPrint "Warning: ${RELEASE_TAG} resolved to $3, not the installer-expected ${RELEASE_COMMIT}. Continuing with fetched tag."
    ${EndIf}

    nsExec::ExecToLog 'git checkout --detach $3'
    Pop $0
    ${If} $0 != 0
      ${If} $5 == "1"
        nsExec::ExecToLog 'git stash apply -q'
        Pop $1
        ${If} $1 == 0
          nsExec::ExecToLog 'git stash drop -q'
          Pop $1
        ${EndIf}
      ${EndIf}
      MessageBox MB_OK|MB_ICONSTOP "Failed to check out release ${RELEASE_TAG}.$\r$\n$\r$\nYour files were left in place. Please resolve local changes or reinstall into a clean folder."
      Abort
    ${EndIf}

    nsExec::ExecToStack 'git rev-parse HEAD'
    Pop $0
    Pop $2
    ${If} $2 != "$3"
      ${If} $5 == "1"
        nsExec::ExecToLog 'git stash apply -q'
        Pop $1
        ${If} $1 == 0
          nsExec::ExecToLog 'git stash drop -q'
          Pop $1
        ${EndIf}
      ${EndIf}
      MessageBox MB_OK|MB_ICONSTOP "Repository update did not land on the expected ${RELEASE_TAG} commit.$\r$\n$\r$\nPlease run the installer again after resolving local repository state."
      Abort
    ${EndIf}

    ${If} $5 == "1"
      nsExec::ExecToLog 'git stash apply -q'
      Pop $0
      ${If} $0 == 0
        nsExec::ExecToLog 'git stash drop -q'
        Pop $0
      ${Else}
        nsExec::ExecToLog 'git reset --hard HEAD'
        Pop $0
        DetailPrint "Warning: local changes are preserved in git stash and could not be reapplied automatically."
      ${EndIf}
    ${EndIf}
    DetailPrint "Repository updated."
  ${Else}
    DetailPrint "Cloning ${APP_NAME} repository..."
    DetailPrint "This may take 2-5 minutes depending on your internet speed."
    DetailPrint ""
    ; Reserve unique per-run paths so cleanup only targets directories this
    ; installer instance created.
    StrCpy $CLONE_DIR_CREATED "0"
    StrCpy $STAGE_DIR_CREATED "0"
    ClearErrors
    GetTempFileName $CLONE_DIR "$TEMP"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Failed to create a temporary download path.$\r$\n$\r$\nPlease check folder permissions and run the installer again."
      Abort
    ${EndIf}
    ClearErrors
    Delete "$CLONE_DIR"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Failed to prepare a temporary download path.$\r$\n$\r$\nPlease check folder permissions and run the installer again."
      Abort
    ${EndIf}
    ClearErrors
    CreateDirectory "$CLONE_DIR"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Failed to create a temporary download directory.$\r$\n$\r$\nPlease check folder permissions and run the installer again."
      Abort
    ${EndIf}
    StrCpy $CLONE_DIR_CREATED "1"

    ${GetParent} "$INSTDIR" $STAGE_PARENT
    ClearErrors
    GetTempFileName $STAGE_DIR "$STAGE_PARENT"
    ${If} ${Errors}
      ${If} $CLONE_DIR_CREATED == "1"
        RMDir /r "$CLONE_DIR"
      ${EndIf}
      MessageBox MB_OK|MB_ICONSTOP "Failed to create a temporary staging path.$\r$\n$\r$\nPlease check folder permissions and run the installer again."
      Abort
    ${EndIf}
    ClearErrors
    Delete "$STAGE_DIR"
    ${If} ${Errors}
      ${If} $CLONE_DIR_CREATED == "1"
        RMDir /r "$CLONE_DIR"
      ${EndIf}
      MessageBox MB_OK|MB_ICONSTOP "Failed to prepare a temporary staging path.$\r$\n$\r$\nPlease check folder permissions and run the installer again."
      Abort
    ${EndIf}
    ClearErrors
    CreateDirectory "$STAGE_DIR"
    ${If} ${Errors}
      ${If} $CLONE_DIR_CREATED == "1"
        RMDir /r "$CLONE_DIR"
      ${EndIf}
      MessageBox MB_OK|MB_ICONSTOP "Failed to create a temporary staging directory.$\r$\n$\r$\nPlease check folder permissions and run the installer again."
      Abort
    ${EndIf}
    StrCpy $STAGE_DIR_CREATED "1"
    ; Clone the pinned release tag instead of mutable origin/main.
    nsExec::ExecToLog 'git clone --branch ${RELEASE_TAG} --depth 1 "${REPO_URL}" "$CLONE_DIR"'
    Pop $0
    ${If} $0 != 0
      ; Retry without depth limit in case shallow clone failed
      DetailPrint "Shallow clone failed, trying full clone..."
      ${If} $CLONE_DIR_CREATED == "1"
        RMDir /r "$CLONE_DIR"
      ${EndIf}
      nsExec::ExecToLog 'git clone --branch ${RELEASE_TAG} "${REPO_URL}" "$CLONE_DIR"'
      Pop $0
      ${If} $0 != 0
        ${If} $CLONE_DIR_CREATED == "1"
          RMDir /r "$CLONE_DIR"
        ${EndIf}
        ${If} $STAGE_DIR_CREATED == "1"
          RMDir /r "$STAGE_DIR"
        ${EndIf}
        MessageBox MB_OK|MB_ICONSTOP "\
Failed to download ${APP_NAME}.$\r$\n$\r$\n\
Please check your internet connection and try again.$\r$\n\
If the problem persists, try downloading manually from:$\r$\n\
${APP_URL}"
        Abort
      ${EndIf}
    ${EndIf}
    nsExec::ExecToStack 'cmd /c cd /d "$CLONE_DIR" && git rev-parse HEAD'
    Pop $0
    Pop $2
    ${If} $0 != 0
      ${If} $CLONE_DIR_CREATED == "1"
        RMDir /r "$CLONE_DIR"
      ${EndIf}
      ${If} $STAGE_DIR_CREATED == "1"
        RMDir /r "$STAGE_DIR"
      ${EndIf}
      MessageBox MB_OK|MB_ICONSTOP "Downloaded release ${RELEASE_TAG} could not be verified.$\r$\n$\r$\nInstallation was stopped before publishing files."
      Abort
    ${EndIf}
    ${If} $2 == ""
      ${If} $CLONE_DIR_CREATED == "1"
        RMDir /r "$CLONE_DIR"
      ${EndIf}
      ${If} $STAGE_DIR_CREATED == "1"
        RMDir /r "$STAGE_DIR"
      ${EndIf}
      MessageBox MB_OK|MB_ICONSTOP "Downloaded release ${RELEASE_TAG} resolved to an empty commit.$\r$\n$\r$\nInstallation was stopped before publishing files."
      Abort
    ${EndIf}
    ${If} "${RELEASE_COMMIT}" != ""
    ${AndIf} $2 != "${RELEASE_COMMIT}"
      DetailPrint "Warning: ${RELEASE_TAG} resolved to $2, not the installer-expected ${RELEASE_COMMIT}. Continuing with fetched tag."
    ${EndIf}
    DetailPrint "Staging downloaded files..."
    ; robocopy returns 0-7 for success, 8+ for errors
    nsExec::ExecToLog 'robocopy "$CLONE_DIR" "$STAGE_DIR" /E /MOVE /NFL /NDL /NJH /NJS'
    Pop $0
    ${If} $0 == "error"
      ${If} $CLONE_DIR_CREATED == "1"
        RMDir /r "$CLONE_DIR"
      ${EndIf}
      ${If} $STAGE_DIR_CREATED == "1"
        RMDir /r "$STAGE_DIR"
      ${EndIf}
      MessageBox MB_OK|MB_ICONSTOP "Failed to move downloaded files into the installation directory.$\r$\n$\r$\nPlease choose an empty folder and run the installer again."
      Abort
    ${EndIf}
    ${If} $0 >= 8
      ${If} $CLONE_DIR_CREATED == "1"
        RMDir /r "$CLONE_DIR"
      ${EndIf}
      ${If} $STAGE_DIR_CREATED == "1"
        RMDir /r "$STAGE_DIR"
      ${EndIf}
      MessageBox MB_OK|MB_ICONSTOP "Failed to move downloaded files into the installation directory.$\r$\n$\r$\nPlease choose an empty folder and run the installer again."
      Abort
    ${EndIf}
    ${If} $CLONE_DIR_CREATED == "1"
      RMDir /r "$CLONE_DIR"
      StrCpy $CLONE_DIR_CREATED "0"
    ${EndIf}
    DetailPrint "Publishing files into place..."
    SetOutPath "$TEMP"
    ClearErrors
    RMDir "$INSTDIR"
    ${If} ${Errors}
      ${If} $STAGE_DIR_CREATED == "1"
        RMDir /r "$STAGE_DIR"
      ${EndIf}
      MessageBox MB_OK|MB_ICONSTOP "The installation directory is not empty.$\r$\n$\r$\nPlease choose an empty folder and run the installer again."
      Abort
    ${EndIf}
    ClearErrors
    Rename "$STAGE_DIR" "$INSTDIR"
    ${If} ${Errors}
      ${If} $STAGE_DIR_CREATED == "1"
        RMDir /r "$STAGE_DIR"
      ${EndIf}
      MessageBox MB_OK|MB_ICONSTOP "Failed to move downloaded files into the installation directory.$\r$\n$\r$\nPlease choose an empty folder and run the installer again."
      Abort
    ${EndIf}
    StrCpy $STAGE_DIR_CREATED "0"
    SetOutPath "$INSTDIR"
    DetailPrint "Download complete."
  ${EndIf}

  ; ── Step 3: Install dependencies ──
  DetailPrint ""
  DetailPrint "═══ Step 3/6: Installing dependencies ═══"
  DetailPrint ""
  DetailPrint "Running pnpm install (this may take 2-5 minutes)..."
  ${If} $PNPM_RUNNER == "corepack"
    nsExec::ExecToLog 'cmd /c corepack pnpm@${PNPM_VERSION} install'
    Pop $0
  ${EndIf}
  ${If} $PNPM_RUNNER == "npx"
    nsExec::ExecToLog 'cmd /c npx --yes pnpm@${PNPM_VERSION} install'
    Pop $0
  ${EndIf}
  ${If} $PNPM_RUNNER == "pnpm"
    nsExec::ExecToLog 'cmd /c pnpm install'
    Pop $0
  ${EndIf}
  ${If} $0 != 0
    DetailPrint "Warning: pnpm install reported issues."
    MessageBox MB_YESNO|MB_ICONEXCLAMATION "\
Dependency installation reported errors.$\r$\n$\r$\n\
This sometimes happens due to network issues.$\r$\n\
Would you like to retry?" IDYES retryInstall IDNO skipRetryInstall
    retryInstall:
      DetailPrint "Retrying pnpm install..."
      ${If} $PNPM_RUNNER == "corepack"
        nsExec::ExecToLog 'cmd /c corepack pnpm@${PNPM_VERSION} install'
        Pop $0
      ${EndIf}
      ${If} $PNPM_RUNNER == "npx"
        nsExec::ExecToLog 'cmd /c npx --yes pnpm@${PNPM_VERSION} install'
        Pop $0
      ${EndIf}
      ${If} $PNPM_RUNNER == "pnpm"
        nsExec::ExecToLog 'cmd /c pnpm install'
        Pop $0
      ${EndIf}
    skipRetryInstall:
  ${EndIf}
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Dependency installation failed.$\r$\n$\r$\nPlease check your internet connection and run the installer again."
    Abort
  ${EndIf}
  DetailPrint "Dependencies installed."

  ; ── Step 4: Build ──
  DetailPrint ""
  DetailPrint "═══ Step 4/6: Building the application ═══"
  DetailPrint ""
  DetailPrint "Building ${APP_NAME} (this may take 1-3 minutes)..."
  ${If} $PNPM_RUNNER == "corepack"
    nsExec::ExecToLog 'cmd /c corepack pnpm@${PNPM_VERSION} --filter @marinara-engine/shared build'
    Pop $0
    ${If} $0 == 0
      nsExec::ExecToLog 'cmd /c corepack pnpm@${PNPM_VERSION} --filter @marinara-engine/server --filter @marinara-engine/client --parallel run build'
      Pop $0
    ${EndIf}
  ${EndIf}
  ${If} $PNPM_RUNNER == "npx"
    nsExec::ExecToLog 'cmd /c npx --yes pnpm@${PNPM_VERSION} --filter @marinara-engine/shared build'
    Pop $0
    ${If} $0 == 0
      nsExec::ExecToLog 'cmd /c npx --yes pnpm@${PNPM_VERSION} --filter @marinara-engine/server --filter @marinara-engine/client --parallel run build'
      Pop $0
    ${EndIf}
  ${EndIf}
  ${If} $PNPM_RUNNER == "pnpm"
    nsExec::ExecToLog 'cmd /c pnpm --filter @marinara-engine/shared build'
    Pop $0
    ${If} $0 == 0
      nsExec::ExecToLog 'cmd /c pnpm --filter @marinara-engine/server --filter @marinara-engine/client --parallel run build'
      Pop $0
    ${EndIf}
  ${EndIf}
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "${APP_NAME} could not be built.$\r$\n$\r$\nInstallation was stopped so it does not leave you with a broken launcher."
    Abort
  ${EndIf}
  DetailPrint "Build complete."

  ; ── Step 5: Copy assets and create shortcuts ──
  DetailPrint ""
  DetailPrint "═══ Step 5/6: Creating shortcuts ═══"
  DetailPrint ""

  ; Copy app icon
  SetOutPath "$INSTDIR"
  File "app-icon.ico"

  ; Desktop shortcut
  DetailPrint "Creating desktop shortcut..."
  Push "$DESKTOP\${APP_NAME}.lnk"
  Call CreateAppShortcut

  ; Start Menu folder
  DetailPrint "Creating Start Menu entries..."
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  Push "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Call CreateAppShortcut
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\Uninstall ${APP_NAME}.lnk" "$INSTDIR\uninstall.exe" "" "$INSTDIR\app-icon.ico" 0

  ; ── Step 6: Uninstaller & registry ──
  DetailPrint ""
  DetailPrint "═══ Step 6/6: Finishing up ═══"
  DetailPrint ""

  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Save install dir for future installs/upgrades
  WriteRegStr HKCU "Software\${APP_NAME}" "InstallDir" "$INSTDIR"

  ; Add/Remove Programs entry
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "URLInfoAbout" "${APP_URL}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayIcon" "$INSTDIR\app-icon.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "NoRepair" 1

  ; Estimate installed size for Add/Remove Programs
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "EstimatedSize" $0

  DetailPrint ""
  DetailPrint "═══ Installation Complete! ═══"
  DetailPrint ""
  DetailPrint "${APP_NAME} v${APP_VERSION} is ready to use."
  DetailPrint 'Launch it from the desktop shortcut or Start Menu.'
  DetailPrint "It will open in your browser at http://127.0.0.1:7860"
  DetailPrint ""
  DetailPrint "To update in the future: open Settings > Check for Updates"
SectionEnd

; ──────────────────────────────────────────────
; Uninstall Section
; ──────────────────────────────────────────────
Section "Uninstall"
  SetDetailsPrint both

  DetailPrint "Removing desktop shortcut..."
  Delete "$DESKTOP\${APP_NAME}.lnk"

  DetailPrint "Removing Start Menu entries..."
  RMDir /r "$SMPROGRAMS\${APP_NAME}"

  DetailPrint "Removing registry entries..."
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
  DeleteRegKey HKCU "Software\${APP_NAME}"

  DetailPrint "Removing application files..."
  ; Only remove known app directories — preserve user data if they stored it elsewhere
  RMDir /r "$INSTDIR\node_modules"
  RMDir /r "$INSTDIR\.pnpm-store"
  RMDir /r "$INSTDIR\packages"
  RMDir /r "$INSTDIR\android"
  RMDir /r "$INSTDIR\docs"
  RMDir /r "$INSTDIR\installer"
  RMDir /r "$INSTDIR\.git"
  Delete "$INSTDIR\*.json"
  Delete "$INSTDIR\*.yaml"
  Delete "$INSTDIR\*.yml"
  Delete "$INSTDIR\*.ts"
  Delete "$INSTDIR\*.js"
  Delete "$INSTDIR\*.cjs"
  Delete "$INSTDIR\*.sh"
  Delete "$INSTDIR\*.bat"
  Delete "$INSTDIR\*.md"
  Delete "$INSTDIR\*.ico"
  Delete "$INSTDIR\Dockerfile"
  Delete "$INSTDIR\uninstall.exe"

  ; Keep the data/ directory (user chats, characters, etc.)
  ; Show a message about it
  ${If} ${FileExists} "$INSTDIR\data\*.*"
    MessageBox MB_YESNO|MB_ICONQUESTION "\
${APP_NAME} has been uninstalled.$\r$\n$\r$\n\
Your data (chats, characters, personas, etc.) is still in:$\r$\n\
$INSTDIR\data$\r$\n$\r$\n\
Would you like to delete your data too?" IDYES deleteData IDNO keepData
    deleteData:
      RMDir /r "$INSTDIR\data"
      RMDir /r "$INSTDIR"
      Goto doneUninstall
    keepData:
      DetailPrint "User data preserved in $INSTDIR\data"
      Goto doneUninstall
  ${Else}
    RMDir /r "$INSTDIR"
  ${EndIf}

  doneUninstall:
  DetailPrint "Uninstallation complete."
SectionEnd
