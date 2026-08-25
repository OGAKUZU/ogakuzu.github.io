#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
collect.py - 適時開示を自動収集してCSVに貯める（Pythonだけ・LLM不要）

30分ごとにTDnetを見に行き、新しい開示だけをCSVに追記します。
AIは使わないので軽い（メモリ数十MB）。つけっぱなしにできます。

使い方（コマンドプロンプトで）:
  python collect.py                 # 30分ごとに自動収集（Ctrl+Cで停止）
  python collect.py --once          # 1回だけ実行して終了（タスクスケジューラ向け）
  python collect.py --interval 900  # 15分ごとにする（秒で指定）
  python collect.py --pdf           # 重要な開示のPDFも自動ダウンロード
  python collect.py --edinet        # EDINETの大量保有報告書も収集（要APIキー）
  python collect.py --report        # 今日集めた分の要約を表示するだけ
  python collect.py --once --outdir "C:\\Users\\ytata\\マイドライブ\\kabu-data"
                                    # Googleドライブ同期フォルダに保存（Claudeが読めるようになる）

保存先（自動で作られます）:
  data/tdnet_YYYYMMDD.csv   … その日の全開示（Excelでそのまま開けます）
  data/important.csv        … 重要な開示だけを日付をまたいで蓄積
  pdf/                      … --pdf 指定時のPDF保存先
  collect.log               … 実行の記録
"""

import argparse
import csv
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
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "data")
PDF_DIR = os.path.join(BASE, "pdf")
LOG_PATH = os.path.join(BASE, "collect.log")
IMPORTANT_CSV = os.path.join(DATA_DIR, "important.csv")


def set_output_dir(outdir: str):
    """保存先を差し替える（Googleドライブ同期フォルダを指定するとClaudeが読めます）

    優先順位: --outdir 引数 > 環境変数 KABU_DATA_DIR > 既定(スクリプトと同じ場所/data)
    """
    global DATA_DIR, PDF_DIR, IMPORTANT_CSV
    outdir = os.path.expandvars(os.path.expanduser(outdir))
    DATA_DIR = outdir
    PDF_DIR = os.path.join(outdir, "pdf")
    IMPORTANT_CSV = os.path.join(DATA_DIR, "important.csv")

HOT_WORDS = [
    "上方修正", "業績予想の修正", "業績予想及び配当予想の修正",
    "配当予想の修正", "増配", "株式分割", "公開買付", "TOB",
    "業務提携", "資本提携", "受注", "子会社化", "特別利益",
    "自己株式の取得に係る事項", "自己株式取得に係る事項", "自社株買い",
    "株主優待", "月次",
]
BAD_WORDS = [
    "下方修正", "減配", "無配", "特別損失", "上場廃止", "監理銘柄",
    "公募増資", "第三者割当", "特別調査委員会", "調査委員会の設置",
    "決算発表の延期", "提出期限延長", "不適切", "不正", "課徴金",
    "業務停止", "民事再生", "会社更生", "債務超過",
]
NOISE_WORDS = [
    "に関する日々の開示事項", "譲渡制限付株式", "自己株式取得状況",
    "自己株式の取得状況", "ストックオプション", "新株予約権の行使",
    "決算説明資料", "決算説明会資料", "補足資料", "FACT BOOK", "ファクトブック",
    "コーポレート・ガバナンス", "定款", "臨時報告書", "変更報告書",
]

CSV_HEADER = ["取得日時", "開示時刻", "コード", "会社名", "表題", "区分", "PDF_URL"]


def log(msg: str):
    line = f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
    print(line)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except Exception:
        pass


def classify(title: str) -> str:
    for w in BAD_WORDS:
        if w in title:
            return "悪材料"
    if any(w in title for w in NOISE_WORDS):
        return "定例"
    for w in HOT_WORDS:
        if w in title:
            return "好材料"
    if "決算短信" in title:
        return "決算"
    return "その他"


# ───────────────────── 取得 ─────────────────────

def fetch_tdnet(date_plain: str, max_pages: int = 8):
    items = []
    for page in range(1, max_pages + 1):
        url = TDNET_URL.format(page=page, date=date_plain)
        try:
            r = requests.get(url, headers=UA, timeout=30)
        except Exception as e:
            log(f"❌ 取得エラー(p{page}): {e}")
            break
        if r.status_code != 200:
            break
        html = None
        for enc in ("utf-8", "cp932", "shift_jis"):
            try:
                html = r.content.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        if html is None:
            html = r.content.decode("utf-8", errors="replace")
        page_items = parse_tdnet(html)
        if not page_items:
            break
        items.extend(page_items)
    return items


def parse_tdnet(html: str):
    rows = []
    for m in re.finditer(r"<tr[^>]*>(.*?)</tr>", html, re.S | re.I):
        tr = m.group(1)
        t = re.search(r'class="kjTime"[^>]*>\s*([^<]+?)\s*<', tr)
        c = re.search(r'class="kjCode"[^>]*>\s*([^<]+?)\s*<', tr)
        n = re.search(r'class="kjName"[^>]*>\s*([^<]+?)\s*<', tr)
        a = re.search(r'class="kjTitle"[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>\s*(.*?)\s*</a>', tr, re.S)
        if t and c and a:
            title = re.sub(r"<[^>]+>", "", a.group(2)).strip()
            href = a.group(1)
            if not href.startswith("http"):
                href = "https://www.release.tdnet.info/inbs/" + href.lstrip("./")
            rows.append((t.group(1).strip(), c.group(1).strip(),
                         n.group(1).strip() if n else "", title, href))
    if rows:
        return rows
    # 保険: class名が変わった場合
    for m in re.finditer(r"<tr[^>]*>(.*?)</tr>", html, re.S | re.I):
        tr = m.group(1)
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S | re.I)
        if len(tds) < 4:
            continue
        p = [re.sub(r"<[^>]+>", "", x).strip() for x in tds]
        if not re.match(r"^\d{1,2}:\d{2}$", p[0]):
            continue
        lm = re.search(r'href="([^"]+\.pdf)"', tr, re.I)
        href = lm.group(1) if lm else ""
        if href and not href.startswith("http"):
            href = "https://www.release.tdnet.info/inbs/" + href.lstrip("./")
        rows.append((p[0], p[1], p[2], p[3], href))
    return rows


def fetch_edinet(date_dash: str, api_key: str):
    try:
        r = requests.get(EDINET_URL, headers=UA, timeout=60,
                         params={"date": date_dash, "type": 2, "Subscription-Key": api_key})
        r.raise_for_status()
    except Exception as e:
        log(f"❌ EDINET取得エラー: {e}")
        return []
    return r.json().get("results", [])


# ───────────────────── 保存 ─────────────────────

def load_existing_keys(path: str):
    keys = set()
    if not os.path.exists(path):
        return keys
    try:
        with open(path, encoding="utf-8-sig", newline="") as fh:
            for row in csv.DictReader(fh):
                keys.add((row.get("開示時刻", ""), row.get("コード", ""), row.get("表題", "")))
    except Exception as e:
        log(f"⚠️ 既存CSVの読み込みに失敗: {e}")
    return keys


def append_csv(path: str, rows):
    """Excelで文字化けしないよう utf-8-sig で保存"""
    new_file = not os.path.exists(path)
    with open(path, "a", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        if new_file:
            w.writerow(CSV_HEADER)
        w.writerows(rows)


def download_pdf(url: str, code: str, title: str):
    if not url:
        return None
    os.makedirs(PDF_DIR, exist_ok=True)
    safe = re.sub(r'[\\/:*?"<>|]', "_", title)[:40]
    fn = os.path.join(PDF_DIR, f"{datetime.date.today():%Y%m%d}_{code}_{safe}.pdf")
    if os.path.exists(fn):
        return fn
    try:
        r = requests.get(url, headers=UA, timeout=60)
        if r.status_code == 200:
            with open(fn, "wb") as fh:
                fh.write(r.content)
            return fn
    except Exception as e:
        log(f"⚠️ PDF取得失敗({code}): {e}")
    return None


# ───────────────────── 1サイクル ─────────────────────

def run_once(args) -> int:
    os.makedirs(DATA_DIR, exist_ok=True)
    today = datetime.date.today()
    date_dash = args.date or today.strftime("%Y-%m-%d")
    date_plain = date_dash.replace("-", "")
    day_csv = os.path.join(DATA_DIR, f"tdnet_{date_plain}.csv")

    items = fetch_tdnet(date_plain)
    if not items:
        log("開示0件（休日、またはまだ開示なし）")
        return 0

    known = load_existing_keys(day_csv)
    now = f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S}"
    new_rows, important_rows, hot_titles = [], [], []

    for t, code, name, title, url in items:
        key = (t, code, title)
        if key in known:
            continue
        known.add(key)  # 同一実行内の重複も防ぐ
        kind = classify(title)
        row = [now, t, code, name, title, kind, url]
        new_rows.append(row)
        if kind in ("好材料", "悪材料"):
            important_rows.append(row)
            hot_titles.append((kind, t, code, name, title, url))

    if new_rows:
        append_csv(day_csv, new_rows)
    if important_rows:
        append_csv(IMPORTANT_CSV, important_rows)

    log(f"取得 {len(items)}件 / 新着 {len(new_rows)}件 / 重要 {len(important_rows)}件 → {os.path.basename(day_csv)}")

    for kind, t, code, name, title, url in hot_titles:
        mark = "🔥" if kind == "好材料" else "⚠️"
        print(f"   {mark} {t} [{code}] {name} … {title}")
        if args.pdf:
            saved = download_pdf(url, code, title)
            if saved:
                print(f"        📥 {os.path.basename(saved)}")

    # EDINET（任意）
    if args.edinet:
        key = os.environ.get("EDINET_API_KEY")
        if key:
            docs = fetch_edinet(date_dash, key)
            tg = [d for d in docs if d.get("docDescription")
                  and ("大量保有" in d["docDescription"] or "変更報告" in d["docDescription"])]
            if tg:
                ed_csv = os.path.join(DATA_DIR, f"edinet_{date_plain}.csv")
                rows = [[now, d.get("submitDateTime", ""), d.get("secCode", "") or "",
                         d.get("filerName", ""), d.get("docDescription", ""), "大量保有", ""]
                        for d in tg]
                known_ed = load_existing_keys(ed_csv)
                rows = [r for r in rows if (r[1], r[2], r[4]) not in known_ed]
                if rows:
                    append_csv(ed_csv, rows)
                log(f"EDINET 大量保有 {len(tg)}件（新着{len(rows)}件）")
        else:
            log("⚠️ EDINET_API_KEY 未設定のためEDINETはスキップ")

    return len(new_rows)


def show_report(date_plain: str):
    path = os.path.join(DATA_DIR, f"tdnet_{date_plain}.csv")
    if not os.path.exists(path):
        print(f"{path} がありません。まず collect.py を実行してください。")
        return
    counts, hot = {}, []
    with open(path, encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            k = row.get("区分", "その他")
            counts[k] = counts.get(k, 0) + 1
            if k in ("好材料", "悪材料"):
                hot.append(row)
    print(f"\n━━ {date_plain} の収集結果 ━━")
    for k, v in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {k}: {v}件")
    print(f"\n── 重要な開示 {len(hot)}件 ──")
    for row in hot:
        mark = "🔥" if row["区分"] == "好材料" else "⚠️"
        print(f"  {mark} {row['開示時刻']} [{row['コード']}] {row['会社名']} … {row['表題']}")
    print(f"\nCSV: {path}")


def main():
    p = argparse.ArgumentParser(description="適時開示の自動収集（Pythonのみ・AI不要）")
    p.add_argument("--once", action="store_true", help="1回だけ実行して終了")
    p.add_argument("--interval", type=int, default=1800, help="収集間隔（秒。既定1800=30分）")
    p.add_argument("--pdf", action="store_true", help="重要な開示のPDFも保存")
    p.add_argument("--edinet", action="store_true", help="EDINET大量保有も収集")
    p.add_argument("--date", help="対象日 YYYY-MM-DD（既定=今日）")
    p.add_argument("--report", action="store_true", help="収集済みデータの要約を表示")
    p.add_argument("--outdir", help="CSVの保存先フォルダ（Googleドライブ同期フォルダを指定するとClaudeが読めます）")
    args = p.parse_args()

    outdir = args.outdir or os.environ.get("KABU_DATA_DIR")
    if outdir:
        set_output_dir(outdir)

    date_plain = (args.date or datetime.date.today().strftime("%Y-%m-%d")).replace("-", "")

    if args.report:
        show_report(date_plain)
        return

    if args.once:
        run_once(args)
        return

    log(f"📡 自動収集を開始します（{args.interval}秒ごと / 停止は Ctrl+C）")
    try:
        while True:
            run_once(args)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        log("収集を停止しました。")


if __name__ == "__main__":
    main()
