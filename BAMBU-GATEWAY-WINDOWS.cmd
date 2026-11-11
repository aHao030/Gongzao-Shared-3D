@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0"
if errorlevel 1 exit /b 1
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required.
  pause
  popd
  exit /b 1
)
node tools\bambu-gateway.mjs
set "GONGZAO_GATEWAY_EXIT=%ERRORLEVEL%"
pause
popd
exit /b %GONGZAO_GATEWAY_EXIT%
