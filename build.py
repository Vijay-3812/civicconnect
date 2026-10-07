#!/usr/bin/env python3
"""Assemble CivicConnect from its part files into one self-contained HTML file."""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
P = ROOT / 'parts'
OUT = ROOT / 'index.html'

CDN = """<!-- External libraries (cdnjs only): Leaflet 1.9.4, GSAP 3 + ScrollTrigger, Chart.js 4.
     Every one of them is optional at runtime: the app feature-detects and falls back. -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js" crossorigin="anonymous"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js" crossorigin="anonymous"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js" crossorigin="anonymous"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js" crossorigin="anonymous"></script>
</head>"""

parts = ['01_head_styles.html', '02_body_shell.html', '03_utils_i18n.html', '04_store_seed.html',
         '05_services_actions.html', '06_motion.html', '07_components_map.html', '08_views_core.html',
         '09_views_dashboards.html', '10_app_demo_boot.html']

html = ''
for name in parts:
    chunk = (P / name).read_text(encoding='utf-8')
    if name == '01_head_styles.html':   # the CDN block is injected before </head>
        assert chunk.rstrip().endswith('</head>')
        chunk = chunk.rstrip()[:-len('</head>')].rstrip() + '\n' + CDN + '\n'
    html += chunk

OUT.write_text(html, encoding='utf-8')
print(f"wrote {OUT} — {len(html)/1024:.1f} KB, {html.count(chr(10))+1} lines")

# ---- sanity checks -------------------------------------------------------
problems = []
if html.count('<script') != html.count('</script>'):
    problems.append(f"script tag mismatch: {html.count('<script')} open / {html.count('</script>')} close")
for bad in ['TODO', 'lorem ipsum', 'FIXME', 'undefinedundefined']:
    if bad.lower() in html.lower():
        problems.append(f"placeholder text found: {bad}")
if len(re.findall(r'<script[^>]+src="https://cdnjs\.cloudflare\.com', html)) != 4:
    problems.append("expected exactly 4 cdnjs script tags")
for m in re.finditer(r'<script[^>]+src="([^"]+)"', html):
    if 'cdnjs.cloudflare.com' not in m.group(1) and 'fonts.googleapis' not in m.group(1):
        problems.append('non-cdnjs remote script: ' + m.group(1))
# every referenced SVG symbol must exist
symbols = set(re.findall(r'<symbol id="([^"]+)"', html))
used = set(re.findall(r'<use href="#([a-z0-9-]+)"', html)) | set(re.findall(r"use href=\\?\"?#?\\?\"?([a-z0-9-]+)", html))
used = {u for u in used if not u.startswith('i-') or u in symbols}
# runtime-constructed icon names
dynamic = set(re.findall(r"#i-\$\{", html))
missing = sorted(u for u in used if u not in symbols)
if missing:
    problems.append('missing svg symbols: ' + ', '.join(missing))
# JS validity: hand the script block to node --check (authoritative)
import subprocess, tempfile, os
script = html.split('<script>', 1)[1].rsplit('</script>', 1)[0]
with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as fh:
    fh.write(script); tmp = fh.name
r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
if r.returncode != 0:
    problems.append('node --check failed: ' + r.stderr.strip().splitlines()[0])
os.unlink(tmp)
# ids referenced by getElementById must exist in the markup (catch typos)
ids_defined = set(re.findall(r'id="([^"]+)"', html))
ids_used = set(re.findall(r"getElementById\(['\"]([^'\"]+)", script)) | set(re.findall(r"#([A-Za-z][-\w]*)\.", script))
dynamic_ids = {'heroParticles', 'pickerMap', 'detailMap', 'landingMap', 'map', 'miniMap', 'confettiCanvas'}
unknown = sorted(i for i in ids_used if i not in ids_defined and i not in dynamic_ids and not i.startswith('chart'))
if unknown:
    problems.append('getElementById targets missing from markup: ' + ', '.join(unknown))
print('symbols:', len(symbols), '| used:', len([u for u in used if u in symbols + tuple()]) if False else len(used))
print('PROBLEMS:', problems if problems else 'none')
sys.exit(1 if problems else 0)
