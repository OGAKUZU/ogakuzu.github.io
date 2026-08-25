@echo off
rem  登録した自動収集タスクを全部削除します
chcp 65001 >nul
for %%T in (1_引け直後 2_夕方 3_夜 4_深夜) do (
  schtasks /delete /tn "株の開示収集-%%T" /f
)
echo.
echo 解除しました。
pause
