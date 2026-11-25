@echo off
rem Quality check for the drone setup guide. Double-click to check the guide,
rem or drag a 3D model (.glb / .glb.js) onto this file to check just that model.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer.
  echo   Ask IT to install "Node.js LTS" ^(free, from nodejs.org^), then run qa.bat again.
  echo.
  pause
  exit /b 2
)
if "%~1"=="" (
  node tools\qa.mjs
) else (
  node tools\qa.mjs "%~1"
)
echo.
if exist QA_REPORT.md start "" notepad QA_REPORT.md
pause
