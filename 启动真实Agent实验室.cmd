@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-agent-lab.ps1"
if errorlevel 1 (
  echo.
  echo 启动失败。请查看上方错误提示或 logs 文件夹中的日志。
  pause
)
endlocal
