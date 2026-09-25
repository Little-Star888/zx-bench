"""Render five-model, Swift-focused charts from reviewed benchmark values."""
from html import escape
from pathlib import Path

OUT = Path(__file__).resolve().parent / "assets"
OUT.mkdir(exist_ok=True)

MODELS = [
    ("GSQ", "IQ3_S", 83.72, 84.71, 83.72, 12.12, 5324312, 96.4, 66.75, 55.9),
    ("Swift", "Q4_K_M", 83.40, 84.77, 83.41, 18.02, 2429372, 88.2, 66.40, 53.3),
    ("NVFP4", "NVFP4", 82.61, 83.81, 82.61, 23.72, 5006150, 74.3, 70.70, 43.4),
    ("Bonsai", "PTQ1_0", 80.58, 81.48, 80.58, 5.95, 5176087, 75.8, 45.25, 43.9),
    ("ByteShape", "IQ2_XXS", 76.92, 77.61, 77.07, 8.84, 4088465, 22.8, 27.95, 38.3),
]


def txt(x, y, value, size=16, color="#263548", weight=400, anchor="start"):
    return f'<text x="{x}" y="{y}" fill="{color}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}">{escape(str(value))}</text>'


def save(name, title, desc, body, height=550):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="{height}" viewBox="0 0 1100 {height}" role="img" aria-labelledby="title desc">'
           f'<title id="title">{escape(title)}</title><desc id="desc">{escape(desc)}</desc>'
           '<style>text{font-family:"Microsoft YaHei","Noto Sans CJK SC",Arial,sans-serif}</style>'
           f'<rect width="1100" height="{height}" rx="18" fill="#f7f9fc"/>{"".join(body)}</svg>')
    (OUT / name).write_text(svg, encoding="utf-8")


body = [txt(32, 48, "五模型成绩与资源画像", 27, "#17263d", 700),
        txt(32, 78, "共同 801 题；主模型文件为十进制 GB；输出 Token 为当前保存的逐题结果", 14, "#627287"),
        txt(32, 123, "模型 / 量化", 15, "#52647a", 700),
        txt(300, 123, "综合分", 15, "#52647a", 700),
        txt(665, 123, "主文件", 15, "#52647a", 700),
        txt(865, 123, "输出 Token", 15, "#52647a", 700)]
for i, (name, quant, score, _, __, gb, out, *___) in enumerate(MODELS):
    y = 170 + i * 66
    color = "#087a80" if name == "Swift" else "#477aa3"
    body += [f'<rect x="20" y="{y-27}" width="1060" height="52" rx="9" fill="{"#e0f2ef" if name == "Swift" else ("#fff" if i % 2 == 0 else "#eef2f7")}"/>',
             txt(32, y + 6, name, 18, "#173047", 700), txt(172, y + 6, quant, 14, "#5e7185", 600),
             f'<rect x="300" y="{y-8}" width="{(score-70)*19:.1f}" height="16" rx="8" fill="{color}"/>',
             txt(594, y + 6, f"{score:.2f}", 18, color, 700, "end"),
             f'<rect x="665" y="{y-8}" width="{gb*5.5:.1f}" height="16" rx="8" fill="#dd955d"/>',
             txt(812, y + 6, f"{gb:.2f} GB", 15, "#825329", 700, "end"),
             f'<rect x="865" y="{y-8}" width="{out/1000000*22:.1f}" height="16" rx="8" fill="#9271b4"/>',
             txt(1067, y + 6, f"{out/1000000:.2f}M", 15, "#61437c", 700, "end")]
body += [txt(32, 516, "综合分条形从 70 分起；文件大小与 Token 条形从 0 起。ByteShape Token 为可观测下限。", 13, "#637388")]
save("score-size-token.svg", "五模型成绩、文件体积和输出 Token", "Swift 总分接近 GSQ，但输出 Token 约为后者的 46%", body)

body = [txt(32, 48, "高难题组：Swift 的能力分布", 27, "#17263d", 700),
        txt(32, 78, "数学和抗幻觉为递进题最终问 P4；编程为 20 道长任务原题均分", 14, "#627287")]
cols = [(285, "数学 P4"), (545, "编程长任务"), (805, "幻觉 P4")]
for x, label in cols:
    body.append(txt(x+109, 126, label, 16, "#40566d", 700, "middle"))
for i, row in enumerate(MODELS):
    name, *_, math, code, hall = row
    y = 156 + i * 66
    body += [f'<rect x="20" y="{y-13}" width="1060" height="54" rx="9" fill="{"#e0f2ef" if name == "Swift" else ("#fff" if i % 2 == 0 else "#eef2f7")}"/>', txt(32, y+21, name, 18, "#173047", 700)]
    for (x, _), val in zip(cols, (math, code, hall)):
        shade = "#b6dfd5" if val >= 85 else "#d5e9e4" if val >= 70 else "#f4e4bc" if val >= 50 else "#f4d1c9"
        body += [f'<rect x="{x}" y="{y-4}" width="218" height="42" rx="8" fill="{shade}"/>', txt(x+109, y+23, f"{val:.1f}", 19, "#253547", 700, "middle")]
body.append(txt(32, 516, "颜色仅辅助阅读；各题组分母和加权方式不同，勿合并为总分。", 13, "#637388"))
save("hard-tasks.svg", "五模型高难题组对比", "Swift 在数学最终问与长重构强，复杂证据最终问仍失分明显", body)

body = [txt(32, 48, "评分口径变化：Swift 在去安全维度后微弱领先", 27, "#17263d", 700),
        txt(32, 78, "三种口径均基于共同 801 题；宽松格式仅复核已确认的表达等价误扣", 14, "#627287")]
labels = [(310, "原分", 2), (555, "去安全权限", 3), (800, "宽松格式", 4)]
for x, label, _ in labels:
    body.append(txt(x, 125, label, 16, "#40566d", 700))
for i, row in enumerate(MODELS):
    name = row[0]
    y = 165+i*66
    body += [f'<rect x="20" y="{y-25}" width="1060" height="51" rx="9" fill="{"#e0f2ef" if name == "Swift" else ("#fff" if i%2==0 else "#eef2f7")}"/>',txt(32,y+6,name,18,"#173047",700)]
    for x, _, k in labels:
        value = row[k]
        body += [f'<rect x="{x}" y="{y-8}" width="{(value-70)*8:.1f}" height="16" rx="8" fill="{"#087a80" if name == "Swift" else "#477aa3"}"/>', txt(x+171,y+6,f"{value:.2f}",16,"#253e54",700,"end")]
body.append(txt(32, 516, "横条均从 70 分起；去安全权限为剩余九维权重归一化，宽松格式并非全量语义重判。", 13, "#637388"))
save("scoring-variants.svg", "五模型评分口径对比", "原分、去安全权限和核验后的宽松格式分", body)
