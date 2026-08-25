@echo off
rem ============================================================
rem  タスク登録.bat -- これをダブルクリックするだけ
rem  平日 15:40 / 17:10 / 20:00 / 23:00 に自動で開示を収集します
rem ============================================================
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_task.ps1"
echo.
pause
