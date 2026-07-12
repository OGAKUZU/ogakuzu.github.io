# 引き継ぎ・操作マニュアル（あなた用）

Claudeが使えなくなっても仕組みを続けられるように、現状の全体像と、
あなた自身で操作する手順をまとめたものです。2026-07-12時点。

---

## 1. いま動いているもの（Claude課金が有効な間）

| 名前 | いつ | 何をする | トリガーID |
|---|---|---|---|
| モーニングリサーチv3 | 毎朝5時(JST) | 朝イチ候補リスト＋8カテゴリ調査 → Googleドライブ保存＋スマホ通知 | `trig_01DsAFsMagM1Xha4zKksCKcC` |
| アフター検証 | 平日18時(JST) | 朝の候補を実際の値動きで答え合わせ → Excel台帳をドライブ保存＋通知 | `trig_01GZcyhjbiV8Q9q23JUu4d4g` |

- 成果物の保存先: Googleドライブの「**日本株モーニングリサーチ**」フォルダ
  （朝のレポート、検証台帳.xlsx、勉強用ドキュメント。Claudeが止まっても消えません）
- 止めたい/時刻を変えたいとき: Claudeのチャットで
  「トリガー `trig_...` を無効化して」「実行時刻を6時に変えて」と言うだけ

---

## 2. Claudeが使えなくなったら何が起きるか

- **止まるもの**: 上の2つの自動実行（朝のレポートと夕方の検証）
- **残るもの**: Googleドライブの全ファイル、このリポジトリの全ファイル
  （調査仕様のプロンプト全文、バックアップ用プログラム、過去レポート）

---

## 3. 復旧方法A: Claudeを再開したとき（いちばん簡単・5分）

1. claude.ai/code で新しいセッションを開く（このリポジトリを接続）
2. 次のように依頼する:
   > `automation/daily-research-prompt.md` の内容で、毎日 cron `0 20 * * *`
   > (UTC) に新しいセッションで実行するRoutineを作って。通知はプッシュとメール。
3. 検証も同様に:
   > `automation/verification-prompt.md` の内容で、cron `0 9 * * 1-5` (UTC)
   > のRoutineを作って。
4. 翌朝5時から自動で再開されます

---

## 4. 復旧方法B: GitHub Actions版を起動する（Claudeなしで動く保険・10分）

月額プランなしで、APIの従量課金だけで同じ調査・検証を続ける方法です。
リポジトリに全部入っており、**3つの操作だけで起動**します。

### 手順（スマホのブラウザでも可能）

1. **APIキーを発行**: https://console.anthropic.com にログイン
   → API Keys → Create Key。事前にクレジットを購入（$5〜でOK。
   使い切ったら止まるだけなので使いすぎの心配なし）
2. **GitHubにキーを登録**: このリポジトリのページ → Settings →
   Secrets and variables → Actions → New repository secret →
   Name: `ANTHROPIC_API_KEY`、Secret: 発行したキー → Add secret
3. **このブランチをmainにマージ**: リポジトリの Pull requests →
   New pull request → base: main / compare: claude/jp-stock-research-automation-ww63u1
   → Create pull request → Merge
   （定期実行はmainブランチでのみ動くため必須）

### 動作確認（初回のみ推奨）

- Actions タブ → `daily-stock-research` → Run workflow で手動実行
- 数分後、`reports/` フォルダに `2026-XX-XX.md` ができれば成功
- 検証も同様に `daily-verification` を手動実行（朝のレポートがある日のみ動く）

### 結果の見方

| 内容 | 場所 |
|---|---|
| 朝のレポート | リポジトリの `reports/日付.md`（スマホはGitHubアプリが便利） |
| 検証台帳Excel | `reports/朝イチ検証台帳.xlsx`（GitHubからダウンロードして開く） |
| 検証の生データ | `reports/verification-ledger.csv` |

### 費用の目安と注意

- 朝＋夕あわせて1日あたり数十円〜300円程度（調査量・為替で変動。
  consoleのUsageページで実額を確認できます）
- 安くしたい場合: 各ワークフローの `Run` ステップに
  `RESEARCH_MODEL: claude-sonnet-5` の環境変数を足すと約半額以下になります
- **このリポジトリが公開(public)の場合、reports/の中身も公開されます。**
  嫌な場合は Settings → General → Danger Zone → Change visibility → Private に
  （GitHub Pagesのサイトは見られなくなる点だけ注意）

### 止め方

- 一時停止: Actions タブ → 各ワークフロー → 右上「…」→ Disable workflow
- 完全停止: リポジトリの Secrets から `ANTHROPIC_API_KEY` を削除

---

## 5. ファイル一覧（何がどこにあるか）

| ファイル | 役割 |
|---|---|
| `automation/daily-research-prompt.md` | 朝の調査の完全な設計図（プロンプト全文） |
| `automation/verification-prompt.md` | 夕方の検証の完全な設計図 |
| `automation/run_research.py` | 朝の調査のGitHub Actions版プログラム |
| `automation/run_verification.py` | 夕方の検証のGitHub Actions版プログラム |
| `.github/workflows/daily-stock-research.yml` | 朝の定期実行設定（毎日 UTC 20:00） |
| `.github/workflows/daily-verification.yml` | 夕方の定期実行設定（平日 UTC 9:00） |
| `automation/daily-stock-research.md` | 仕組み全体の設定記録 |
| `automation/MANUAL.md` | このマニュアル |

## 6. よくある質問

- **Q. ChatGPTなど他のAIでも使える？**
  A. `daily-research-prompt.md` / `verification-prompt.md` を貼り付ければ
  調査部分はそのまま動きます（Drive保存・通知の指示は無視されるだけ）。
- **Q. GitHub Actions版はGoogleドライブに保存される？**
  A. されません（Googleの認証が必要になるため）。代わりにリポジトリの
  `reports/` に保存されます。Excelはダウンロードして開いてください。
- **Q. 両方動いたら二重になる？**
  A. なります。Claudeを再開したらどちらか一方に（Actions側はSecrets削除で停止）。

---

*本仕組みの出力はすべて公開情報の整理・シミュレーションであり投資助言では
ありません。投資判断はご自身の責任で行ってください。*
