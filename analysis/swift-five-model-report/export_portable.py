"""Make portable PNG, self-contained HTML, and print-ready PDF inputs."""
from __future__ import annotations

import base64
from pathlib import Path
import re

import fitz
from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "Swift与五模型全维度测评报告-20260925.md"
TARGET = ROOT / "Swift与五模型全维度测评报告-单文件.html"

for svg in (ROOT / "assets").glob("*.svg"):
    png = svg.with_suffix(".png")
    document = fitz.open(stream=svg.read_bytes(), filetype="svg")
    pix = document[0].get_pixmap(matrix=fitz.Matrix(2.5, 2.5), alpha=False)
    pix.save(png)
    document.close()

markdown = SOURCE.read_text(encoding="utf-8")
markdown = re.sub(r"(!\[[^]]*\]\(assets/[^)]+)\.svg(\))", r"\1.png\2", markdown)
html = MarkdownIt("default").render(markdown)
html = html.replace(
    'href="evidence/',
    'href="https://github.com/suncityldp/zx-bench/blob/main/analysis/swift-five-model-report/evidence/',
)

def embed(match: re.Match[str]) -> str:
    file_path = ROOT / match.group(1)
    payload = base64.b64encode(file_path.read_bytes()).decode("ascii")
    return f'src="data:image/png;base64,{payload}"'

html = re.sub(r'src="(assets/[^" ]+\.png)"', embed, html)
css = """
@page { size: A4; margin: 16mm 15mm 18mm; }
* { box-sizing: border-box; }
html { font-family: "Microsoft YaHei", "Noto Sans SC", sans-serif; color: #233147; background: #eef2f6; }
body { max-width: 950px; margin: 28px auto; padding: 40px 48px; background: white; box-shadow: 0 8px 32px #192a3c24; line-height: 1.68; font-size: 14px; }
h1 { color: #17314d; font-size: 29px; line-height: 1.3; margin: 0 0 18px; }
h2 { color: #155f78; font-size: 21px; margin: 32px 0 12px; padding-top: 12px; border-top: 1px solid #d9e4eb; break-after: avoid; }
h3 { color: #244b65; font-size: 17px; break-after: avoid; }
p, li { orphans: 3; widows: 3; }
img { display: block; width: 100%; max-width: 100%; height: auto; margin: 18px auto 22px; break-inside: avoid; }
table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 14px 0 21px; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { background: #e8f0f4; color: #234058; font-weight: 700; }
th, td { border: 1px solid #c9d8e1; padding: 6px 7px; vertical-align: top; }
tbody tr:nth-child(even) { background: #f7fafb; }
td:not(:first-child), th:not(:first-child) { text-align: right; }
strong { color: #173c5c; }
a { color: #145f8b; text-decoration: none; }
code { font-family: Consolas, monospace; background: #eef3f6; padding: 1px 3px; border-radius: 3px; }
@media print {
 html { background: white; }
 body { max-width: none; padding: 0; margin: 0; box-shadow: none; font-size: 10.1pt; line-height: 1.55; }
 h1 { font-size: 20pt; } h2 { font-size: 15pt; } h3 { font-size: 12pt; }
 table { font-size: 8.2pt; }
 img { max-height: 173mm; object-fit: contain; }
 a { color: #145f8b; }
}
"""
TARGET.write_text(f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Swift 与五模型全维度测评报告</title><style>{css}</style></head><body>{html}</body></html>', encoding="utf-8")
print(TARGET)
for png in (ROOT / "assets").glob("*.png"):
    print(png, png.stat().st_size)
