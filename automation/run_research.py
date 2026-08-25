"""日本株モーニングリサーチ — GitHub Actions版（保険用）

Claude Code の Routine が使えなくなった場合のバックアップ。
Claude API のWeb検索ツールで automation/daily-research-prompt.md の
調査を実行し、レポートを reports/YYYY-MM-DD.md に書き出す。

必要な環境変数:
  ANTHROPIC_API_KEY  console.anthropic.com で発行したAPIキー
  RESEARCH_MODEL     省略時 claude-opus-4-8
"""

import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import anthropic

JST = timezone(timedelta(hours=9))
REPO_ROOT = Path(__file__).resolve().parent.parent
PROMPT_FILE = REPO_ROOT / "automation" / "daily-research-prompt.md"
REPORTS_DIR = REPO_ROOT / "reports"

MODEL = os.environ.get("RESEARCH_MODEL", "claude-opus-4-8")
MAX_CONTINUATIONS = 8  # Web検索のサーバ側ループ(pause_turn)の再開上限


def build_prompt() -> str:
    spec = PROMPT_FILE.read_text(encoding="utf-8")
    # ファイル冒頭の説明文を除き、プロンプト本文だけを使う
    if "## プロンプト本文" in spec:
        spec = spec.split("## プロンプト本文", 1)[1]
    # 配信手順（Google Drive等はActionsでは使えない）を除去し、調査仕様だけ渡す
    spec = re.sub(r"【配信手順.*?(?=\n【|\Z)", "", spec, flags=re.S)
    today = datetime.now(JST).strftime("%Y年%m月%d日 (%A)")
    return (
        f"今日は日本時間 {today} の朝です。\n"
        "以下の仕様に従い、Web検索を使って調査を行い、"
        "Markdown形式のレポート本文のみを出力してください。"
        "前置きや後書きは不要です。\n\n"
        "-----\n" + spec
    )


def run() -> str:
    client = anthropic.Anthropic()
    tools = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 20}]
    user_prompt = build_prompt()
    messages = [{"role": "user", "content": user_prompt}]

    response = None
    for _ in range(MAX_CONTINUATIONS):
        with client.messages.stream(
            model=MODEL,
            max_tokens=32000,
            thinking={"type": "adaptive"},
            tools=tools,
            messages=messages,
        ) as stream:
            response = stream.get_final_message()
        if response.stop_reason != "pause_turn":
            break
        # サーバ側ツールのイテレーション上限。会話を積んで再開する
        messages = [
            {"role": "user", "content": user_prompt},
            {"role": "assistant", "content": response.content},
        ]

    if response is None:
        raise RuntimeError("APIから応答が得られませんでした")
    if response.stop_reason == "refusal":
        raise RuntimeError("リクエストが拒否されました (stop_reason=refusal)")

    report = "\n".join(b.text for b in response.content if b.type == "text")
    if not report.strip():
        raise RuntimeError(f"レポート本文が空です (stop_reason={response.stop_reason})")

    usage = response.usage
    print(
        f"model={response.model} stop={response.stop_reason} "
        f"in={usage.input_tokens} out={usage.output_tokens}",
        file=sys.stderr,
    )
    return report


def main() -> None:
    report = run()
    REPORTS_DIR.mkdir(exist_ok=True)
    out = REPORTS_DIR / f"{datetime.now(JST).strftime('%Y-%m-%d')}.md"
    out.write_text(report, encoding="utf-8")
    print(str(out))


if __name__ == "__main__":
    main()
