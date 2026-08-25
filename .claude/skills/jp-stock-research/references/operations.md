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

自動化済み。`C:\kabu\タスク登録.bat` を1回実行すると、平日 **15:40 / 17:10 / 20:00 / 23:00** に自動収集する（スリープ解除あり・電源断の取りこぼしは次回起動時に回収）。

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
