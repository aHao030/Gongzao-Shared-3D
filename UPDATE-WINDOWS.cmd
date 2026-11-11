@echo off
setlocal DisableDelayedExpansion
pushd "%~dp0"
if errorlevel 1 exit /b 1
where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo Windows PowerShell is required. No files were changed.
  pause
  popd
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update-windows.ps1" %*
set "GONGZAO_EXIT=%ERRORLEVEL%"
echo.
pause
popd
exit /b %GONGZAO_EXIT%
