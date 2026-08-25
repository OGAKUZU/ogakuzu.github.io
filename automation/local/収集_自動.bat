@echo off
rem ============================================================
rem  収集_自動.bat  --  タスクスケジューラから呼ばれる収集の実行役
rem  手で叩く必要はありません。タスク登録.bat が自動で呼び出します。
rem  第1引数に保存先フォルダ（Googleドライブの kabu-data）を渡します。
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"

set "OUT=%~1"
if "%OUT%"=="" set "OUT=%KABU_DATA_DIR%"

echo. >> collect_auto.log
echo ===== %DATE% %TIME% ===== >> collect_auto.log

if "%OUT%"=="" (
  echo [警告] 保存先が指定されていません。既定の data フォルダに保存します。 >> collect_auto.log
  python collect.py --once --pdf >> collect_auto.log 2>&1
) else (
  python collect.py --once --pdf --outdir "%OUT%" >> collect_auto.log 2>&1
)

echo 終了コード=%ERRORLEVEL% >> collect_auto.log
exit /b %ERRORLEVEL%
