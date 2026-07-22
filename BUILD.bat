@echo off
title Game Boost FPS PRO BY Ty.ppw - Builder
color 0B
echo.
echo  ================================================
echo    Game Boost FPS PRO  BY Ty.ppw   (v5.0)
echo    Building .EXE ... please wait
echo  ================================================
echo.

node --version > nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found!
    echo Install LTS from https://nodejs.org , RESTART your PC, then run this again.
    pause
    exit /b
)
for /f "tokens=*" %%v in ('node --version') do echo [OK] Node.js %%v

echo [^>^>] Cleaning old build (auto: kill + delete)...
taskkill /F /IM GameBoostFPS.exe /T > nul 2>&1
taskkill /F /IM electron.exe /T > nul 2>&1
timeout /t 1 /nobreak > nul
if exist "%~dp0GameBoostFPS_Build" (
    rmdir /s /q "%~dp0GameBoostFPS_Build" > nul 2>&1
    if exist "%~dp0GameBoostFPS_Build" (
        echo [!] Old build partly locked - close any GameBoostFPS window or restart PC, then run again.
    ) else (
        echo [OK] Old build removed.
    )
)

set APPDIR=%~dp0GameBoostFPS_Build
if not exist "%APPDIR%" mkdir "%APPDIR%"
if not exist "%APPDIR%\src" mkdir "%APPDIR%\src"

echo [^>^>] Copying files...
copy "%~dp0main.js"          "%APPDIR%\main.js"          > nul
copy "%~dp0icon.ico"         "%APPDIR%\icon.ico"         > nul
copy "%~dp0src\preload.js"   "%APPDIR%\src\preload.js"   > nul
copy "%~dp0src\index.html"   "%APPDIR%\src\index.html"   > nul
copy "%~dp0src\splash.html"  "%APPDIR%\src\splash.html"  > nul

echo [^>^>] Writing package.json...
(
echo {
echo   "name": "game-boost-fps-pro",
echo   "version": "5.0.0",
echo   "main": "main.js",
echo   "scripts": { "build": "electron-builder --win" },
echo   "build": {
echo     "appId": "com.typpw.gameboostfps",
echo     "productName": "GameBoostFPS",
echo     "asar": true,
echo     "win": {
echo       "target": "portable",
echo       "icon": "icon.ico",
echo       "requestedExecutionLevel": "requireAdministrator"
echo     },
echo     "portable": { "artifactName": "GameBoostFPS_Ty.ppw.exe" },
echo     "files": ["main.js", "src/**/*", "icon.ico"]
echo   },
echo   "devDependencies": {
echo     "electron": "^28.3.0",
echo     "electron-builder": "^24.13.3"
echo   }
echo }
) > "%APPDIR%\package.json"

echo [^>^>] Installing Electron (3-5 min, one time)...
cd /d "%APPDIR%"
call npm install --save-dev electron electron-builder
call npm install discord-rpc 2>nul && echo [OK] Discord RPC ready || echo [i] Discord RPC skipped ^(optional^)
if errorlevel 1 ( echo [ERROR] npm install failed & pause & exit /b )

echo [^>^>] Building EXE...
call npm run build
if errorlevel 1 ( echo [ERROR] Build failed - see errors above & pause & exit /b )

echo.
echo  ================================================
echo    BUILD SUCCESS!
echo    Portable EXE: GameBoostFPS_Build\dist\GameBoostFPS_Ty.ppw.exe
echo  ================================================
echo.
explorer "%APPDIR%\dist"
pause
