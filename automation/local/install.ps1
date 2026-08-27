# ============================================================
#  install.ps1 -- 開示の自動収集を、1行で入れるためのスクリプト
#
#  使い方（コマンドプロンプトに1行貼るだけ）:
#    powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr https://raw.githubusercontent.com/OGAKUZU/ogakuzu.github.io/main/automation/local/install.ps1 -OutFile $env:TEMP\kabu_install.ps1 -UseBasicParsing; & $env:TEMP\kabu_install.ps1"
#
#  やること:
#    1. collect.py のある場所を探す
#    2. 必要なファイルをGitHubから取ってくる（文字化けしないようShift-JISで保存）
#    3. Windowsタスクスケジューラに平日4回の自動収集を登録する
# ============================================================

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

Write-Host ""
Write-Host "=== 株の開示収集 かんたんインストール ===" -ForegroundColor Cyan
Write-Host ""

# --- 1. collect.py のある場所を探す ---------------------------------------
$targets = @("C:\kabu", (Join-Path $env:USERPROFILE "kabu"), "D:\kabu", (Join-Path $env:USERPROFILE "Documents\kabu"))
$dest = $null
foreach ($t in $targets) {
    if (Test-Path (Join-Path $t "collect.py")) { $dest = $t; break }
}

if (-not $dest) {
    Write-Host "[??] collect.py が見つかりませんでした。" -ForegroundColor Yellow
    Write-Host "     collect.py が入っているフォルダのパスを貼り付けてください。"
    Write-Host "     （例: C:\kabu）"
    $typed = Read-Host "フォルダのパス"
    if (-not $typed -or -not (Test-Path (Join-Path $typed "collect.py"))) {
        Write-Host "[NG] そのフォルダに collect.py がありません: $typed" -ForegroundColor Red
        Write-Host ""
        Read-Host "Enterキーで終了します"
        exit 1
    }
    $dest = $typed
}
Write-Host "[OK] collect.py の場所: $dest" -ForegroundColor Green

# --- 2. ファイルを取ってくる ----------------------------------------------
$base = "https://raw.githubusercontent.com/OGAKUZU/ogakuzu.github.io/main/automation/local/"
$files = @(
    @{ url = "setup_task.ps1";                                      name = "setup_task.ps1" },
    @{ url = "%E3%82%BF%E3%82%B9%E3%82%AF%E7%99%BB%E9%8C%B2.bat";    name = "タスク登録.bat" },
    @{ url = "%E5%8F%8E%E9%9B%86_%E8%87%AA%E5%8B%95.bat";            name = "収集_自動.bat" },
    @{ url = "%E8%A7%A3%E9%99%A4.bat";                              name = "解除.bat" }
)

foreach ($f in $files) {
    $out = Join-Path $dest $f.name
    try {
        $r = Invoke-WebRequest -Uri ($base + $f.url) -UseBasicParsing
        $text = [System.Text.Encoding]::UTF8.GetString($r.Content)
        if ($f.name -like "*.bat") {
            # .bat はコマンドプロンプトの文字コード(Shift-JIS)で保存しないと文字化けする
            [System.IO.File]::WriteAllText($out, $text, [System.Text.Encoding]::GetEncoding(932))
        } else {
            [System.IO.File]::WriteAllText($out, $text, (New-Object System.Text.UTF8Encoding $true))
        }
        Write-Host ("[OK] {0}" -f $f.name) -ForegroundColor Green
    } catch {
        Write-Host ("[NG] {0} を取得できませんでした: {1}" -f $f.name, $_.Exception.Message) -ForegroundColor Red
        Write-Host ""
        Read-Host "Enterキーで終了します"
        exit 1
    }
}

# --- 3. タスクを登録する ---------------------------------------------------
Write-Host ""
Write-Host "--- 続けてタスクスケジューラに登録します ---" -ForegroundColor Cyan
& (Join-Path $dest "setup_task.ps1")
