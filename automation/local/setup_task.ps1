# ============================================================
#  setup_task.ps1 -- 「株の開示収集」をWindowsタスクスケジューラに登録する
#  直接実行せず、同じフォルダの タスク登録.bat をダブルクリックしてください。
# ============================================================

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$runner  = Join-Path $here "収集_自動.bat"
$prefix  = "株の開示収集"

Write-Host ""
Write-Host "=== 株の開示収集 自動化セットアップ ===" -ForegroundColor Cyan
Write-Host ""

# --- 1. 実行役のバッチがあるか -------------------------------------------
if (-not (Test-Path $runner)) {
    Write-Host "[NG] 収集_自動.bat が見つかりません: $runner" -ForegroundColor Red
    Write-Host "     collect.py と同じフォルダに置いてください。"
    exit 1
}
Write-Host "[OK] 実行役: $runner"

# --- 2. Python があるか ---------------------------------------------------
try {
    $pyver = (& python --version) 2>&1
    Write-Host "[OK] Python: $pyver"
} catch {
    Write-Host "[NG] python が見つかりません。" -ForegroundColor Red
    Write-Host "     python.org からインストールし、インストーラの"
    Write-Host "     『Add python.exe to PATH』にチェックを入れてください。"
    exit 1
}

# --- 3. Googleドライブの kabu-data を自動で探す ---------------------------
$candidates = @()
foreach ($d in @("G","H","I","J","K")) {
    $candidates += "${d}:\マイドライブ\kabu-data"
    $candidates += "${d}:\My Drive\kabu-data"
}
$candidates += Join-Path $env:USERPROFILE "マイドライブ\kabu-data"
$candidates += Join-Path $env:USERPROFILE "My Drive\kabu-data"
$candidates += Join-Path $env:USERPROFILE "Google ドライブ\kabu-data"
$candidates += Join-Path $env:USERPROFILE "Google Drive\kabu-data"

$outdir = $null
foreach ($c in $candidates) {
    if (Test-Path $c) { $outdir = $c; break }
}

if ($outdir) {
    Write-Host "[OK] 保存先を自動検出: $outdir" -ForegroundColor Green
} else {
    Write-Host "[??] kabu-data フォルダが自動で見つかりませんでした。" -ForegroundColor Yellow
    Write-Host "     エクスプローラーで kabu-data を開き、アドレスバーのパスを貼り付けてください。"
    Write-Host "     （何も入れずにEnterを押すと、この場所の data フォルダに保存します）"
    $typed = Read-Host "保存先のパス"
    if ($typed) {
        if (-not (Test-Path $typed)) {
            Write-Host "[NG] そのフォルダは存在しません: $typed" -ForegroundColor Red
            exit 1
        }
        $outdir = $typed
    } else {
        $outdir = ""
    }
}

# --- 4. 実行する時刻 ------------------------------------------------------
# 8/24の実測にもとづく。開示は 15:30 / 16:00 / 17:00 / 19:00 / 22:30 に山がある。
$times = [ordered]@{
    "1_引け直後" = "15:40"   # 15:30の開示（決算・特別利益・優待）
    "2_夕方"     = "17:10"   # 16:00〜17:00の本命帯（自社株買い・上方修正・初配）
    "3_夜"       = "20:00"   # 19:00台（大量保有・買集め行為）
    "4_深夜"     = "23:00"   # 22:30まで（CB発行など）。翌朝5時のレポートに間に合わせる
}

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -MultipleInstances IgnoreNew

Write-Host ""
Write-Host "--- タスクを登録します ---"

foreach ($k in $times.Keys) {
    $name = "$prefix-$k"
    $t    = $times[$k]

    $action = New-ScheduledTaskAction `
        -Execute $runner `
        -Argument "`"$outdir`"" `
        -WorkingDirectory $here

    # 平日のみ（土日はTDnetに開示が出ないため）
    $trigger = New-ScheduledTaskTrigger -Weekly `
        -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $t

    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue

    Register-ScheduledTask `
        -TaskName $name `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description "TDnetの適時開示を収集し $outdir に保存します（平日 $t）" | Out-Null

    Write-Host ("[OK] {0}  平日 {1}" -f $name, $t) -ForegroundColor Green
}

Write-Host ""
Write-Host "=== 登録が完了しました ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "保存先 : $outdir"
Write-Host "実行   : 平日の 15:40 / 17:10 / 20:00 / 23:00（1日4回）"
Write-Host ""
Write-Host "・PCがスリープ中でも自動で起きて実行します。"
Write-Host "・PCの電源が切れていた時刻の分は、次に起動したときにまとめて実行されます。"
Write-Host "・実行の記録は collect_auto.log に残ります。"
Write-Host ""
Write-Host "今すぐ1回テスト実行しますか？ (Y/N)"
$ans = Read-Host
if ($ans -eq "Y" -or $ans -eq "y") {
    Start-ScheduledTask -TaskName "$prefix-2_夕方"
    Write-Host "実行しました。数十秒後に collect_auto.log を確認してください。" -ForegroundColor Green
}
Write-Host ""
Write-Host "解除したいときは 解除.bat をダブルクリックしてください。"
