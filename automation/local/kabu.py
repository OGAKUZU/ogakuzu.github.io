#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
kabu.py - ローカルLLM(LM Studio)で株の開示・決算を解読するツール

あなたのPCで動きます。クラウドは使わないので無料・無制限・オフライン(EDINET取得時を除く)。

使い方（コマンドプロンプトで）:
  python kabu.py                      # 貼り付けたテキストを解読（Aモード）
  python kabu.py -m b                 # 決算の「予想比」チェック（Bモード）
  python kabu.py -m c                 # 材料の質を25点満点で採点（Cモード）
  python kabu.py -m d -t 逆日歩       # 用語の即席辞書
  python kabu.py --edinet             # 今日のEDINET大量保有報告書を取得して一覧表示
  python kabu.py --edinet --analyze   # 上記＋ローカルLLMで解説

事前準備:
  1. LM Studioを起動 → 左の「Developer(</>)」タブ → Start Server （既定 http://localhost:1234）
  2. モデルを読み込んでおく（Gemma 4 E4B など）
  3. pip install requests
"""

import argparse
import json
import os
import sys
import datetime

try:
    import requests
except ImportError:
    print("requests が必要です。コマンドプロンプトで:  pip install requests")
    sys.exit(1)

LM_BASE = os.environ.get("LMSTUDIO_BASE", "http://127.0.0.1:1234/v1")
LM_URL = LM_BASE + "/chat/completions"
LM_MODELS_URL = LM_BASE + "/models"
EDINET_URL = "https://api.edinet-fsa.go.jp/api/v2/documents.json"

_MODEL_CACHE = {"name": None}

SYSTEM_PROMPT = """あなたは日本株の初心者向け解説アシスタントです。以下を必ず守ってください。
1. 中学生にも分かる言葉で書く。専門用語には毎回カッコで一言説明を付ける（例:「進捗率（＝年間目標のうち何%まで稼いだか）」）。
2. ユーザーが貼り付けた文章の中にある情報だけを使う。書かれていないことは「この文章からは分かりません」と正直に言う。推測で数字を作らない。
3. 株価の予想や「買い/売り」の推奨はしない。事実の整理と、注意すべき点の指摘までにとどめる。
4. 回答は短く。箇条書きを使う。最後に必ず「確認すべきこと」を1〜2個挙げる。
5. 「市場予想との比較」が本文にない場合は、必ず「予想比が不明なので良し悪しは判断できません」と明記する。
"""

PROMPTS = {
    "a": """以下は日本企業の適時開示（または決算・ニュース）の本文です。次の形式で整理してください。

【1行でいうと】
【何が起きたか】（事実だけ、箇条書き3つまで）
【なぜ株価に効くか】（初心者向けに理屈を説明）
【注意点・悪材料になりうる点】
【確認すべきこと】（1〜2個）

--- 本文ここから ---
{text}""",

    "b": """以下の決算情報について、次の観点で整理してください。分からない項目は「記載なし」と書いてください。

1. 前年同期比で増益か減益か（数字）
2. 会社の通期予想に対する進捗率（＝年間目標のうち何%まで来たか）
3. 市場予想（コンセンサス）との比較の記載があるか。あれば上回ったか下回ったか
4. 増配・自社株買い・上方修正など、株主還元や上振れの要素があるか
5. この情報だけで「良い決算」と言い切れるか、それとも判断材料が足りないか

--- 本文ここから ---
{text}""",

    "c": """以下は株の材料（ニュース）です。「本物の材料か、話題先行か」を見分ける練習をしたいので、次の基準で採点してください（各5点満点、合計25点）。

1. 業績への直結度（増益・増配・受注など数字があるか）
2. 継続性（一時的な話題か、来期以降も効くか）
3. 具体性（金額・数量・時期が書かれているか）
4. 確度（決定事項か、検討中・思惑段階か）
5. 意外性（すでに知られていた話か、新しい情報か）

最後に合計点と、「なぜその点数か」を2〜3行で説明してください。株価予想はしないでください。

--- 材料ここから ---
{text}""",

    "d": """次の株式用語を、中学生にも分かるように説明してください。
・たとえ話を1つ使う
・なぜ株価に関係するのかを一言添える
・3行以内

用語: {text}""",
}


def detect_model() -> str:
    """LM Studio に読み込まれているモデル名を自動取得する"""
    if _MODEL_CACHE["name"]:
        return _MODEL_CACHE["name"]
    try:
        r = requests.get(LM_MODELS_URL, timeout=15)
        r.raise_for_status()
        data = r.json().get("data", [])
        if data:
            _MODEL_CACHE["name"] = data[0].get("id", "")
            return _MODEL_CACHE["name"]
    except Exception:
        pass
    return ""


def ask_local_llm(prompt: str, temperature: float = 0.3, model: str = "") -> str:
    """LM Studio のローカルサーバーに問い合わせる"""
    model_name = model or detect_model()
    payload = {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
        "stream": False,
    }
    if model_name:
        payload["model"] = model_name
    try:
        r = requests.post(LM_URL, json=payload, timeout=600)
        r.raise_for_status()
    except requests.exceptions.ConnectionError:
        return ("❌ LM Studio につながりません。確認してください:\n"
                "  1. LM Studio が起動しているか\n"
                "  2. 左の「Developer(</>)」タブ →「Start Server」を押したか（Status: Running）\n"
                "  3. モデルが読み込まれているか（「+ Load Model」または Ctrl+L）")
    except Exception as e:
        return f"❌ エラー: {e}"
    try:
        return r.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, json.JSONDecodeError):
        return f"❌ 予期しない応答: {r.text[:300]}"


def read_input_text() -> str:
    """標準入力から本文を読む（Ctrl+Z→Enterで終了 / Macは Ctrl+D）"""
    print("解読したい本文を貼り付けてください。")
    print("終わったら Windows: Ctrl+Z → Enter  /  Mac・Linux: Ctrl+D")
    print("-" * 50)
    return sys.stdin.read().strip()


def fetch_edinet(date_str: str, api_key: str):
    """EDINETの提出書類一覧を取得（日本のIPからのみ利用可）"""
    params = {"date": date_str, "type": 2, "Subscription-Key": api_key}
    try:
        r = requests.get(EDINET_URL, params=params, timeout=60)
        r.raise_for_status()
    except requests.exceptions.HTTPError as e:
        if r.status_code == 403:
            print("❌ 403エラー: APIキーが違うか、海外IP経由の可能性があります。")
        else:
            print(f"❌ HTTPエラー: {e}")
        return []
    except Exception as e:
        print(f"❌ 取得エラー: {e}")
        return []
    return r.json().get("results", [])


def main():
    p = argparse.ArgumentParser(description="ローカルLLMで株の開示を解読する")
    p.add_argument("-m", "--mode", default="a", choices=["a", "b", "c", "d"],
                   help="a=開示解読(既定) b=予想比チェック c=材料採点 d=用語辞書")
    p.add_argument("-t", "--text", help="本文を直接指定（省略時は貼り付け入力）")
    p.add_argument("-f", "--file", help="本文をファイルから読む")
    p.add_argument("--edinet", action="store_true", help="EDINETの大量保有報告書を取得")
    p.add_argument("--date", help="EDINETの対象日 YYYY-MM-DD（既定=今日）")
    p.add_argument("--analyze", action="store_true", help="EDINET結果をローカルLLMで解説")
    p.add_argument("--model", default="", help="使うモデル名（省略時は読み込み済みモデルを自動検出）")
    p.add_argument("--check", action="store_true", help="LM Studioとの接続確認だけ行う")
    args = p.parse_args()

    # --- 接続確認モード ---
    if args.check:
        print(f"接続先: {LM_BASE}")
        try:
            r = requests.get(LM_MODELS_URL, timeout=15)
            r.raise_for_status()
            data = r.json().get("data", [])
        except requests.exceptions.ConnectionError:
            print("❌ サーバーに届きません。LM Studioの Developer(</>) タブで")
            print("   「Start Server」を押して Status: Running にしてください。")
            return
        except Exception as e:
            print(f"❌ エラー: {e}")
            return
        if data:
            print(f"✅ 接続OK。利用できるモデル: {data[0].get('id','')}")
            if len(data) > 1:
                print(f"   （他{len(data)-1}件。--model で指定できます）")
        else:
            print("⚠️ サーバーは動いていますが、モデルが読み込まれていません。")
            print("   LM Studioで「+ Load Model」(Ctrl+L)からモデルを読み込んでください。")
        return

    # --- EDINETモード ---
    if args.edinet:
        api_key = os.environ.get("EDINET_API_KEY")
        if not api_key:
            print("❌ 環境変数 EDINET_API_KEY が未設定です。")
            print('   コマンドプロンプトで:  set EDINET_API_KEY=あなたのキー')
            sys.exit(1)
        date_str = args.date or datetime.date.today().strftime("%Y-%m-%d")
        print(f"📄 EDINET {date_str} の提出書類を取得中...")
        docs = fetch_edinet(date_str, api_key)
        # 大量保有報告書（様式コード等でざっくり抽出）
        targets = [d for d in docs if d.get("docDescription") and
                   ("大量保有" in d["docDescription"] or "変更報告" in d["docDescription"])]
        if not targets:
            print("該当する大量保有報告書は見つかりませんでした（休日・未提出の可能性）。")
            return
        print(f"\n✅ 大量保有関連 {len(targets)} 件\n" + "=" * 50)
        lines = []
        for d in targets:
            line = f"[{d.get('submitDateTime','')}] {d.get('filerName','')} → {d.get('issuerEdinetCode') or ''} {d.get('docDescription','')}"
            print(line)
            lines.append(line)
        if args.analyze:
            print("\n" + "=" * 50)
            print("🤖 ローカルLLMで解説中...(30秒〜数分)\n")
            joined = "\n".join(lines[:30])
            prompt = PROMPTS["a"].format(
                text="以下は本日EDINETに提出された大量保有報告書の一覧です。"
                     "投資ファンドやアクティビスト（＝物言う株主）による提出があれば指摘してください。\n" + joined)
            print(ask_local_llm(prompt, model=args.model))
        return

    # --- 通常モード ---
    if args.text:
        text = args.text
    elif args.file:
        with open(args.file, encoding="utf-8") as fh:
            text = fh.read()
    else:
        text = read_input_text()

    if not text:
        print("本文が空です。")
        sys.exit(1)

    print("\n🤖 ローカルLLMで解読中...(30秒〜数分かかります)\n" + "=" * 50)
    print(ask_local_llm(PROMPTS[args.mode].format(text=text), model=args.model))
    print("=" * 50)
    print("※ローカルLLMの出力です。数字は必ず原文でご確認ください。投資判断はご自身の責任で。")


if __name__ == "__main__":
    main()
