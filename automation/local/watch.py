#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
watch.py - 一次情報リアルタイム監視ツール（TDnet適時開示 + EDINET大量保有）

ニュースサイトより先に、企業が出した「原文」を直接つかむための道具です。
あなたのPC（日本のIP）でのみ動きます。

使い方（コマンドプロンプトで）:
  python watch.py                    # 今日のTDnet適時開示を一覧表示
  python watch.py --watch            # 60秒ごとに監視して新着だけ通知（場中つけっぱなし推奨）
  python watch.py --watch --beep     # 重要キーワードに一致したら音で知らせる
  python watch.py --filter 上方修正   # キーワードで絞る
  python watch.py --edinet           # EDINETの大量保有報告書
  python watch.py --analyze          # 新着をローカルLLMで採点（要LM Studio）
  python watch.py --sources          # 一次情報リンク集を表示
  python watch.py --debug            # 取得したHTMLを保存（表示が変なときの調査用）

事前準備:
  pip install requests
  （--analyze を使う場合のみ）LM Studioでモデルを読み込み Start Server
"""

import argparse
import datetime
import os
import re
import sys
import time

try:
    import requests
except ImportError:
    print("requests が必要です。コマンドプロンプトで:  pip install requests")
    sys.exit(1)

TDNET_URL = "https://www.release.tdnet.info/inbs/I_list_{page:03d}_{date}.html"
EDINET_URL = "https://api.edinet-fsa.go.jp/api/v2/documents.json"
LM_BASE = os.environ.get("LMSTUDIO_BASE", "http://127.0.0.1:1234/v1")

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# 株価が動きやすい重要キーワード（優先度high）
HOT_WORDS = [
    "上方修正", "業績予想の修正", "業績予想及び配当予想の修正",
    "自己株式の取得", "自社株買い", "配当予想の修正", "増配",
    "株式分割", "公開買付", "TOB", "業務提携", "資本提携",
    "受注", "M&A", "子会社化", "特別利益",
]
# 悪材料（下げやすい）
BAD_WORDS = ["下方修正", "減配", "無配", "特別損失", "上場廃止", "監理銘柄", "公募増資", "第三者割当"]

SOURCES = """
━━━ 一次情報リンク集（ニュースより速い情報源） ━━━

【最優先・適時開示】
 TDnet 適時開示情報      https://www.release.tdnet.info/inbs/I_main_00.html
   → 企業が出した瞬間に載る。決算・上方修正・自社株買いの原典
 東証 適時開示検索        https://www2.jpx.co.jp/tseHpFront/JJK020010Action.do

【金融庁・法定開示】
 EDINET                  https://disclosure2.edinet-fsa.go.jp/
   → 大量保有報告書（誰が何%買ったか）・有価証券報告書
 EDINET API 登録          https://api.edinet-fsa.go.jp/  （無料・本ツールで使用）

【需給・市場統計】
 JPX 空売り残高            https://www.jpx.co.jp/markets/public/short-selling/
 JPX 投資部門別売買状況     https://www.jpx.co.jp/markets/statistics-equities/investor-type/
   → 海外投資家が買い越しか売り越しか（毎週木曜）

【金融政策・マクロ】
 日銀 公表資料             https://www.boj.or.jp/whatsnew/index.htm
 財務省 為替介入実績        https://www.mof.go.jp/policy/international_policy/reference/feign_ex_gaitameshosa/
 内閣府 景気動向指数        https://www.esri.cao.go.jp/

【政策・補助金（テーマ株の源流）】
 経産省 新着情報           https://www.meti.go.jp/main/whatsnew.html
 NEDO 公募・採択           https://www.nedo.go.jp/koubo/index.html
 e-Gov パブリックコメント   https://public-comment.e-gov.go.jp/

【海外の先行指標】
 TSMC 月次売上            https://investor.tsmc.com/japanese/monthly-revenue
 韓国 関税庁 輸出速報       https://unipass.customs.go.kr/  （毎月1・11・21日頃）
 SEMI 装置出荷統計         https://www.semi.org/jp

【予測市場（確率の温度計）】
 Polymarket               https://polymarket.com/
   → FOMC・地政学の確率。賭けずに"読むだけ"で使う

━━━ 使い方のコツ ━━━
 ・場中は本ツールの --watch を起動しっぱなしにする
 ・15:00〜16:00 は決算・開示のラッシュ。この時間帯が最も価値が高い
 ・原文を見つけたら kabu.py に貼って「予想比」を必ず確認する
"""


# ────────────────────────── TDnet ──────────────────────────

def fetch_tdnet(date_str: str, max_pages: int = 5, debug: bool = False):
    """TDnetの当日開示一覧を取得。戻り値: [(時刻, コード, 会社名, 表題, PDF URL), ...]"""
    items = []
    for page in range(1, max_pages + 1):
        url = TDNET_URL.format(page=page, date=date_str)
        try:
            r = requests.get(url, headers=UA, timeout=30)
        except Exception as e:
            print(f"❌ 取得エラー: {e}")
            break
        if r.status_code == 404:
            break  # そのページは存在しない＝終わり
        if r.status_code != 200:
            print(f"⚠️ HTTP {r.status_code}（{url}）")
            break

        # 文字コード自動判定（TDnetはUTF-8だがcp932の場合もある）
        html = None
        for enc in ("utf-8", "cp932", "shift_jis"):
            try:
                html = r.content.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        if html is None:
            html = r.content.decode("utf-8", errors="replace")

        if debug:
            fn = f"tdnet_debug_p{page}.html"
            with open(fn, "w", encoding="utf-8") as fh:
                fh.write(html)
            print(f"🔍 デバッグ: {fn} に保存しました")

        page_items = parse_tdnet(html)
        if not page_items:
            break
        items.extend(page_items)
    return items


def parse_tdnet(html: str):
    """TDnetのHTMLから開示行を抜き出す（構造変更に強いよう2段構えで解析）"""
    rows = []
    # 方式1: class名ベース（TDnetの標準構造）
    for m in re.finditer(r"<tr[^>]*>(.*?)</tr>", html, re.S | re.I):
        tr = m.group(1)
        time_m = re.search(r'class="kjTime"[^>]*>\s*([^<]+?)\s*<', tr)
        code_m = re.search(r'class="kjCode"[^>]*>\s*([^<]+?)\s*<', tr)
        name_m = re.search(r'class="kjName"[^>]*>\s*([^<]+?)\s*<', tr)
        title_m = re.search(r'class="kjTitle"[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>\s*(.*?)\s*</a>', tr, re.S)
        if time_m and code_m and title_m:
            title = re.sub(r"<[^>]+>", "", title_m.group(2)).strip()
            href = title_m.group(1)
            if not href.startswith("http"):
                href = "https://www.release.tdnet.info/inbs/" + href.lstrip("./")
            rows.append((time_m.group(1).strip(),
                         code_m.group(1).strip(),
                         name_m.group(1).strip() if name_m else "",
                         title, href))
    if rows:
        return rows

    # 方式2: 汎用（class名が変わった場合の保険）
    for m in re.finditer(r"<tr[^>]*>(.*?)</tr>", html, re.S | re.I):
        tr = m.group(1)
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S | re.I)
        if len(tds) < 4:
            continue
        plain = [re.sub(r"<[^>]+>", "", t).strip() for t in tds]
        if not re.match(r"^\d{1,2}:\d{2}$", plain[0]):
            continue
        link_m = re.search(r'href="([^"]+\.pdf)"', tr, re.I)
        href = link_m.group(1) if link_m else ""
        if href and not href.startswith("http"):
            href = "https://www.release.tdnet.info/inbs/" + href.lstrip("./")
        rows.append((plain[0], plain[1], plain[2], plain[3], href))
    return rows


# ────────────────────────── EDINET ──────────────────────────

def fetch_edinet(date_str: str, api_key: str):
    params = {"date": date_str, "type": 2, "Subscription-Key": api_key}
    try:
        r = requests.get(EDINET_URL, params=params, headers=UA, timeout=60)
        r.raise_for_status()
    except requests.exceptions.HTTPError:
        if r.status_code == 403:
            print("❌ 403: APIキーが違うか、VPN等で海外IP判定されています。")
        else:
            print(f"❌ HTTPエラー: {r.status_code}")
        return []
    except Exception as e:
        print(f"❌ 取得エラー: {e}")
        return []
    return r.json().get("results", [])


# ────────────────────────── ローカルLLM ──────────────────────────

def ask_llm(text: str) -> str:
    try:
        m = requests.get(LM_BASE + "/models", timeout=10).json().get("data", [])
        model = m[0]["id"] if m else ""
    except Exception:
        return "（LM Studio未起動のため解説をスキップしました）"
    prompt = (
        "以下は本日の適時開示のタイトル一覧です。株価に影響しそうなものを最大3つ選び、"
        "それぞれ「なぜ株価に効くか」を中学生にも分かる言葉で1〜2行で説明してください。"
        "専門用語にはカッコで説明を付けてください。株価予想や売買推奨はしないでください。\n\n" + text
    )
    payload = {
        "messages": [
            {"role": "system", "content": "あなたは日本株の初心者向け解説アシスタントです。貼り付けられた情報だけを使い、推測で数字を作らないでください。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3, "stream": False,
    }
    if model:
        payload["model"] = model
    try:
        r = requests.post(LM_BASE + "/chat/completions", json=payload, timeout=600)
        return r.json()["choices"][0]["message"]["content"]
    except Exception as e:
        return f"（解説エラー: {e}）"


# ────────────────────────── 表示 ──────────────────────────

def classify(title: str) -> str:
    for w in BAD_WORDS:
        if w in title:
            return "BAD"
    for w in HOT_WORDS:
        if w in title:
            return "HOT"
    return ""


def show(item, mark_new=False):
    t, code, name, title, url = item
    tag = classify(title)
    prefix = "🆕 " if mark_new else "   "
    if tag == "HOT":
        prefix += "🔥"
    elif tag == "BAD":
        prefix += "⚠️"
    else:
        prefix += "  "
    print(f"{prefix} {t} [{code}] {name} … {title}")
    if tag and url:
        print(f"        {url}")
    return tag


def beep():
    try:
        import winsound
        winsound.Beep(880, 300)
    except Exception:
        print("\a", end="")


# ────────────────────────── メイン ──────────────────────────

def main():
    p = argparse.ArgumentParser(description="一次情報リアルタイム監視（TDnet/EDINET）")
    p.add_argument("--watch", action="store_true", help="新着を繰り返し監視する")
    p.add_argument("--interval", type=int, default=60, help="監視間隔（秒。既定60）")
    p.add_argument("--filter", help="この文字を含む開示だけ表示")
    p.add_argument("--hot", action="store_true", help="重要キーワードに一致するものだけ表示")
    p.add_argument("--beep", action="store_true", help="重要な新着で音を鳴らす")
    p.add_argument("--edinet", action="store_true", help="EDINETの大量保有報告書を取得")
    p.add_argument("--date", help="対象日 YYYY-MM-DD（既定=今日）")
    p.add_argument("--analyze", action="store_true", help="ローカルLLMで解説")
    p.add_argument("--sources", action="store_true", help="一次情報リンク集を表示")
    p.add_argument("--debug", action="store_true", help="取得HTMLを保存")
    args = p.parse_args()

    if args.sources:
        print(SOURCES)
        return

    today = datetime.date.today()
    date_dash = args.date or today.strftime("%Y-%m-%d")
    date_plain = date_dash.replace("-", "")

    # ── EDINETモード ──
    if args.edinet:
        key = os.environ.get("EDINET_API_KEY")
        if not key:
            print("❌ 環境変数 EDINET_API_KEY が未設定です。")
            print('   コマンドプロンプトで:  set EDINET_API_KEY=あなたのキー')
            print("   キー取得（無料）: https://api.edinet-fsa.go.jp/")
            sys.exit(1)
        print(f"📄 EDINET {date_dash} を取得中...")
        docs = fetch_edinet(date_dash, key)
        targets = [d for d in docs if d.get("docDescription")
                   and ("大量保有" in d["docDescription"] or "変更報告" in d["docDescription"])]
        if not targets:
            print("該当なし（休日・未提出の可能性）")
            return
        print(f"\n✅ 大量保有関連 {len(targets)} 件\n" + "=" * 60)
        lines = []
        for d in targets:
            line = f"{d.get('submitDateTime','')} {d.get('filerName','')} → {d.get('docDescription','')}"
            print("  " + line)
            lines.append(line)
        if args.analyze:
            print("\n🤖 ローカルLLMで解説中...\n")
            print(ask_llm("\n".join(lines[:30])))
        return

    # ── TDnetモード ──
    print(f"📡 TDnet適時開示 {date_dash}")
    seen = set()
    first = True
    while True:
        items = fetch_tdnet(date_plain, debug=args.debug)
        if not items and first:
            print("開示が0件でした。休日か、まだ開示が出ていない可能性があります。")
            print("（表示がおかしい場合は --debug を付けて実行し、保存されたHTMLを共有してください）")

        # 絞り込み
        view = items
        if args.filter:
            view = [i for i in view if args.filter in i[3]]
        if args.hot:
            view = [i for i in view if classify(i[3]) == "HOT"]

        new_items = [i for i in view if (i[0], i[1], i[3]) not in seen]
        for i in view:
            seen.add((i[0], i[1], i[3]))

        if first:
            print(f"\n── 現在 {len(view)} 件 ──")
            for i in view[:40]:
                show(i)
            if len(view) > 40:
                print(f"   …ほか{len(view)-40}件")
            if args.analyze and view:
                print("\n🤖 ローカルLLMで解説中...\n")
                print(ask_llm("\n".join(f"[{i[1]}] {i[2]} … {i[3]}" for i in view[:25])))
            first = False
        elif new_items:
            print(f"\n── {datetime.datetime.now():%H:%M:%S} 新着 {len(new_items)}件 ──")
            hot = False
            for i in new_items:
                if show(i, mark_new=True) == "HOT":
                    hot = True
            if hot and args.beep:
                beep()

        if not args.watch:
            break
        try:
            time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\n監視を終了しました。")
            break

    print("\n※開示の原文（PDF）を必ずご確認ください。判断は kabu.py の予想比チェックと併用を。")


if __name__ == "__main__":
    main()
