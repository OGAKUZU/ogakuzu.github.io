# ============================================================
#  fix_task.ps1 -- .bat をやめて PowerShell から python を直接呼ぶように直す
#
#  背景（2026-09-03）:
#    収集_自動.bat が 'hon' は認識されていません を出し続けた。
#    chcp を疑い（8/28）→ 外れ。改行コードを疑い（9/2）→ これも外れ。
#    原因の特定より先に、故障の面そのものを無くす。
#    cmd.exe のバッチ解釈を通さなければ、この種の欠落は起きない。
#
#  使い方（PowerShellに1行貼るだけ。ファイルに保存しない）:
#    iex ((iwr '<コミットSHA入りのraw URL>' -UseBasicParsing).Content)
#
#  ※ このスクリプトは日本語の文字列をパスの判定に使わない。
#     文字化けしても動くように、照合はすべて ASCII で行う。
# ============================================================

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

Write-Host ""
Write-Host "=== collect task fix : stop using .bat ===" -ForegroundColor Cyan
Write-Host ""

# --- 1. 登録済みのタスクを探す（照合はASCIIのみ） -------------------------
$tasks = @(Get-ScheduledTask | Where-Object {
    $_.Actions.Count -gt 0 -and
    $_.Actions[0].Execute -and
    $_.Actions[0].Execute -like "*.bat" -and
    $_.Actions[0].WorkingDirectory -like "*kabu*"
})

if ($tasks.Count -eq 0) {
    Write-Host "[NG] 収集のタスクが見つかりませんでした。" -ForegroundColor Red
    Write-Host "     先に install.ps1 を実行してタスクを登録してください。"
    Write-Host ""
    Read-Host "Enterキーで終了します"
    return
}

$here   = $tasks[0].Actions[0].WorkingDirectory
$outdir = ($tasks[0].Actions[0].Arguments).Trim('"').Trim()
$bat    = $tasks[0].Actions[0].Execute

Write-Host ("[OK] 作業フォルダ : {0}" -f $here)
Write-Host ("[OK] 保存先       : {0}" -f $(if ($outdir) { $outdir } else { "(未設定)" }))
Write-Host ("[OK] 対象タスク   : {0}件" -f $tasks.Count)

# --- 2. 壊れた .bat の中身を記録する（原因を残すため） --------------------
Write-Host ""
Write-Host "--- 壊れていた .bat の実測値（原因の記録用） ---" -ForegroundColor Yellow
if (Test-Path $bat) {
    $b   = [System.IO.File]::ReadAllBytes($bat)
    $cr  = @($b | Where-Object { $_ -eq 13 }).Count
    $lf  = @($b | Where-Object { $_ -eq 10 }).Count
    $n   = [Math]::Min(15, $b.Length - 1)
    $head = ($b[0..$n] | ForEach-Object { $_.ToString('X2') }) -join ' '
    Write-Host ("  ファイル : {0}" -f $bat)
    Write-Host ("  サイズ   : {0} バイト" -f $b.Length)
    Write-Host ("  CR       : {0}" -f $cr)
    Write-Host ("  LF       : {0}" -f $lf)
    Write-Host ("  先頭16B  : {0}" -f $head)
    Write-Host ""
    Write-Host "  ↑ この5行を、そのままコピーして貼ってください。" -ForegroundColor Yellow
    Write-Host "     原因を特定して記録に残します（直すのには使いません）。" -ForegroundColor Yellow
} else {
    Write-Host ("  {0} は存在しませんでした。" -f $bat)
}

# --- 3. 実行役を PowerShell スクリプトとして「この場で」書き出す ----------
#     ネット越しに運ばないので、文字コードも改行コードもズレようがない。
$wrapper = Join-Path $here "collect_auto.ps1"

$body = @'
# collect_auto.ps1 -- タスクスケジューラから呼ばれる収集の実行役
# 手で叩く必要はありません。fix_task.ps1 が自動で作ります。
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
$log = Join-Path $here "collect_auto.log"
$out = if ($args.Count -ge 1) { $args[0] } else { "" }

Add-Content -Path $log -Value "" -Encoding UTF8
Add-Content -Path $log -Value ("===== " + (Get-Date -Format "yyyy/MM/dd HH:mm:ss") + " =====") -Encoding UTF8

if ([string]::IsNullOrWhiteSpace($out)) {
    Add-Content -Path $log -Value "[WARN] outdir not set. saving to default data folder." -Encoding UTF8
    & python collect.py --once --pdf 2>&1 | Add-Content -Path $log -Encoding UTF8
} else {
    & python collect.py --once --pdf --outdir $out 2>&1 | Add-Content -Path $log -Encoding UTF8
}

Add-Content -Path $log -Value ("exit code=" + $LASTEXITCODE) -Encoding UTF8
'@

[System.IO.File]::WriteAllText($wrapper, $body, (New-Object System.Text.UTF8Encoding $true))
Write-Host ""
Write-Host ("[OK] 実行役を作りました: {0}" -f $wrapper) -ForegroundColor Green

# --- 4. タスクの実行役を差し替える ----------------------------------------
$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$wrapper`""
if ($outdir) { $arg += " `"$outdir`"" }

Write-Host ""
foreach ($t in $tasks) {
    $action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument $arg `
        -WorkingDirectory $here
    Set-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -Action $action | Out-Null
    Write-Host ("[OK] 差し替え: {0}" -f $t.TaskName) -ForegroundColor Green
}

# --- 5. 壊れた .bat は名前を変えて、二度と呼ばれないようにする ------------
if (Test-Path $bat) {
    $bak = "$bat.broken"
    if (Test-Path $bak) { Remove-Item $bak -Force }
    Rename-Item -Path $bat -NewName (Split-Path $bak -Leaf)
    Write-Host ""
    Write-Host ("[OK] 壊れた .bat を退避しました: {0}" -f $bak) -ForegroundColor Green
    Write-Host "     消してはいません。中身を見たいときのために残します。"
}

# --- 6. その場で1回テストする ---------------------------------------------
Write-Host ""
Write-Host "--- テスト実行します（40秒ほどかかります） ---" -ForegroundColor Cyan
$log = Join-Path $here "collect_auto.log"
$before = if (Test-Path $log) { (Get-Item $log).Length } else { 0 }

Start-ScheduledTask -TaskName $tasks[0].TaskName -TaskPath $tasks[0].TaskPath
Start-Sleep -Seconds 40

Write-Host ""
Write-Host "--- collect_auto.log の最後 ---" -ForegroundColor Cyan
if (Test-Path $log) {
    Get-Content $log -Tail 8 -Encoding UTF8
    $after = (Get-Item $log).Length
    Write-Host ""
    if ($after -gt $before) {
        Write-Host "[OK] ログが増えました。動いています。" -ForegroundColor Green
        Write-Host "     ===== 日付 ===== の行が出ていれば成功です。"
    } else {
        Write-Host "[??] ログが増えていません。まだ実行中かもしれません。" -ForegroundColor Yellow
        Write-Host "     30秒ほど待って、もう一度この行を実行してください:"
        Write-Host ("     Get-Content `"{0}`" -Tail 8" -f $log)
    }
} else {
    Write-Host "[??] ログがまだありません。" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== 終わりました ===" -ForegroundColor Cyan
Write-Host ""
