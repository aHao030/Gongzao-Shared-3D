@echo off
setlocal DisableDelayedExpansion
pushd "%~dp0"
if errorlevel 1 (
  echo Cannot open the project folder. Extract the entire ZIP first.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required.
  echo Download it from https://nodejs.org/ and run this file again.
  echo No administrator access or npm install is needed by Gongzao.
  pause
  popd
  exit /b 1
)
node tools\launch-local.mjs %*
set "GONGZAO_EXIT=%ERRORLEVEL%"
if not "%GONGZAO_EXIT%"=="0" (
  echo Startup failed. Read the message above.
  pause
)
popd
exit /b %GONGZAO_EXIT%
