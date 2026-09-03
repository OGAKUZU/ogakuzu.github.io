# 運用メモ（ID・パス・復旧手順）

## 場所とID

| もの | 値 |
|---|---|
| Googleドライブ `kabu-data` フォルダ | parentId `1gEXnb9qRNFJWULaWL_lxtPNoxzDbMSQl` |
| Googleドライブ「日本株モーニングリサーチ」フォルダ | parentId `1G6mwb6ncA5B-kvkoC34a90BQbByRk6bV` |
| 判定ボードの公開URL | https://claude.ai/code/artifact/9c69260c-762b-4bdc-ac45-aed4046e8fab |
| ボードの雛形（復元用） | `automation/board/board.html` |
| 検証台帳 | `automation/ledger/history.csv` |
| 開発ブランチ | `claude/jp-stock-research-automation-ww63u1` |

## ボードの更新

scratchpad の `board.html` を書き換えて Artifact ツールを**同じ file_path** で呼ぶ。URLは変わらない。

scratchpad が消えていたら（コンテナ再起動で消える）:

```bash
cp automation/board/board.html <scratchpadのパス>/board.html
```

## ユーザーのPC側（collect.py）

TDnetは**この実行環境からブロックされている**（プロキシが403）。EDINET APIも海外IPを遮断している。したがって**収集はユーザーのWindows PCでしか動かない。**

自動化済み。平日 **15:40 / 17:10 / 20:00 / 23:00** に自動収集する（スリープ解除あり・電源断の取りこぼしは次回起動時に回収）。

**実行役は `C:\kabu\collect_auto.ps1`（PowerShell）。`.bat` は使わない。**

> **⚠️ .bat をこの経路に戻してはいけない（9/3確定）**
>
> 収集_自動.bat が `'hon' は認識されていません`（`python` の先頭3文字が欠ける）を出し続けた。実測は **CR=0 / LF=24**、先頭は `40 65 63 68 6F 20 6F 66 66 0A`＝`@echo off\n`。**LFだけの .bat は cmd.exe が読み取り位置を見失う。**
>
> 8/28に `chcp` を疑って外し、9/2に改行コードだと正しく突き止めたが、**PC上のファイルに修正が当たっていなかった**ため4回失敗が続いた。**「直したつもり」を実測で確かめないと、正しい診断でも失敗は続く。**
>
> 9/3に `automation/local/fix_task.ps1` で実行役を PowerShell に置き換え、**11:14に `tdnet_20260903.csv` がドライブに届いて復旧を確認した**（29件）。壊れた .bat は `収集_自動.bat.broken` として残してある。

やり直したいときの1行（PowerShellに貼る。SHA固定URLでキャッシュを避け、先頭のBOMを落とす）:

```powershell
iex ((iwr 'https://raw.githubusercontent.com/OGAKUZU/ogakuzu.github.io/<SHA>/automation/local/fix_task.ps1' -UseBasicParsing).Content.TrimStart([char]0xFEFF))
```

手で実行してもらう場合のコマンド:

```
cd /d C:\kabu
python collect.py --once --pdf --outdir "G:\マイドライブ\kabu-data"
```

過去日を取りにいく場合は `--date 2026-08-24` を足す。

## ルーティン（定期実行）の再作成

ルーティンは**この会話セッションに紐づいている**ので、セッションが失われたら作り直しが必要。
`mcp__Claude_Code_Remote__create_trigger` を使う。

| 名前 | cron (UTC) | 意味 |
|---|---|---|
| 朝イチ判定ボード | `15 21 * * *` | 毎朝 6:15 JST |
| 答え合わせ | `0 9 * * 1-5` | 平日 18:00 JST |

プロンプトは「このスキル（jp-stock-research）に従って本日分を実行し、ボードを更新して PushNotification を送ること」で足りる。**長いプロンプトを書き直す必要はない。手順はこのスキルにある。**

## やらないこと

- **EDINET APIキーをリポジトリに置かない。** 環境変数 `EDINET_API_KEY` からのみ読む
- **無駄な再試行をしない。** Googleドライブのコネクタが落ちていたら1回で諦め、「ドライブは省略した」と正直に書く
- ユーザーに頼まれない限りPRを作らない
