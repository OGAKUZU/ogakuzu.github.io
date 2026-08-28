@echo off
rem ============================================================
rem  収集_自動.bat  --  タスクスケジューラから呼ばれる収集の実行役
rem  手で叩く必要はありません。タスク登録.bat が自動で呼び出します。
rem  第1引数に保存先フォルダ（Googleドライブの kabu-data）を渡します。
rem
rem  重要: このファイルに chcp を書かないこと。
rem  バッチ実行中にコードページを変えると cmd.exe が読み取り位置を見失い、
rem  後続行の先頭数文字が欠けます（python が hon になる等）。2026-08-28に実害。
rem ============================================================
cd /d "%~dp0"

set "OUT=%~1"
if "%OUT%"=="" set "OUT=%KABU_DATA_DIR%"

echo. >> collect_auto.log
echo ===== %DATE% %TIME% ===== >> collect_auto.log

if "%OUT%"=="" (
  echo [WARN] outdir not set. saving to default data folder. >> collect_auto.log
  python collect.py --once --pdf >> collect_auto.log 2>&1
) else (
  python collect.py --once --pdf --outdir "%OUT%" >> collect_auto.log 2>&1
)

echo exit code=%ERRORLEVEL% >> collect_auto.log
exit /b %ERRORLEVEL%
