# Kitの入口ページ「3ステップ」に置く画面の画像を、サンプル画面から撮り直す。
# 使い方：npx astro build → npx astro preview --port 4321 を動かした状態で
#   python3 scripts/capture-kit-shots.py
# 出力：public/images/tools/{kit}-screen.png（診断・入力画面）、{kit}-sheet.png（完成イメージ）
from playwright.sync_api import sync_playwright

KITS = ["budget-checker", "kpi-check", "budget-simulator", "kpi-sheet-maker", "kpi-analysis"]
BASE = "http://localhost:4321/tools"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 1000}, device_scale_factor=1)
    for kit in KITS:
        for name, q in (("screen", ""), ("sheet", "?tab=sheet")):
            pg.goto(f"{BASE}/{kit}/sample{q}")
            pg.wait_for_timeout(1200)
            # タブの下（入力と判定の画面／完成イメージ）だけを撮る
            # 診断画面は ② 診断・修正の数のまとめから（施策効果診断Kitは「1 年間を入力」のタブから）、完成イメージはサンプルのタブの下から撮る（2026-11-01）
            top = pg.evaluate(
                "(() => { const y = window.scrollY;"
                " if (location.search.includes('tab=sheet')) {"
                "   const t = document.querySelector('.bk-stab').parentElement.getBoundingClientRect();"
                "   return Math.round(t.bottom + y + 12); }"
                " const c = document.querySelector('.bk-ck-sum');"
                " if (c) return Math.round(c.getBoundingClientRect().top + y - 10);"
                " const n = document.querySelector('.bk-tab-n').closest('button, a, div').getBoundingClientRect();"
                " return Math.round(n.top + y + 70); })()"
            )
            pg.screenshot(
                path=f"public/images/tools/{kit}-{name}.png",
                clip={"x": 80, "y": top, "width": 1120, "height": 640},
            )
            print(kit, name, top)
    b.close()
