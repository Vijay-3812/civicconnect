import re, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
html = (ROOT / 'index.html').read_text(encoding='utf-8')
script = html.split('<script>',1)[1].rsplit('</script>',1)[0]
problems = []

# 1. every id selector used in JS must be defined somewhere (markup or template literal)
defined = set(re.findall(r'id="([^"]+)"', html)) | set(re.findall(r"\.id\s*=\s*['\"]([\w-]+)['\"]", script))
used = set(re.findall(r"(?:Utils\.\$\$?\(|querySelector\(|querySelectorAll\()\s*['\"]#([A-Za-z][\w-]*)", script))
used |= set(re.findall(r"getElementById\(['\"]([\w-]+)['\"]", script))
dynamic_ok = {'heroParticles','pickerMap','detailMap','landingMap','map','confettiCanvas','miniMap'}
missing = sorted(u for u in used if u not in defined and u not in dynamic_ok and not re.fullmatch(r'(chart|sla|p|nd|a|e|r|cmt|flag|staff|proof|rej)[\w-]*', u))
if missing: problems.append('id selectors with no matching element: ' + ', '.join(missing))

# 2. icon symbols
symbols = set(re.findall(r'<symbol id="([^"]+)"', html))
icons = set(re.findall(r'href="#(i-[\w-]+)"', html)) | set(re.findall(r"icon:\s*'(i-[\w-]+)'", html))
dyn = set(re.findall(r"#i-\$\{", html))
bad = sorted(i for i in icons if i not in symbols)
if bad: problems.append('missing svg symbols: ' + ', '.join(bad))

# 3. data-i18n keys
keys = set(re.findall(r"data-i18n=\"([^\"]+)\"", html))
en = set(re.findall(r"^\s*'([\w.]+)':", script, re.M))  # loose
i18n_block = script.split('const I18N = {')[1].split("\n};")[0]
en_keys = set(re.findall(r"'([\w.' -]+)':", i18n_block.split("ta: {")[0]))
for k in sorted(keys):
    if k not in en_keys: problems.append('data-i18n key not in dictionary: ' + k)

# 4. t('...') keys must exist (catch typos in dynamic labels)
tkeys = set(re.findall(r"\bt\('([\w. ]+)'(?:,|\))", script))
unknown = sorted(k for k in tkeys if k not in en_keys)
if unknown: problems.append('t() keys missing from EN dictionary: ' + ', '.join(unknown))

# 5. no leftover debug / placeholder code
for pat in [r'\bdebugger\b', r'console\.log\(', r'\bTODO\b', r'\bFIXME\b', r'lorem ipsum', r'undefinedundefined']:
    hits = re.findall(pat, html, re.I)
    if hits: problems.append(f'{pat} appears {len(hits)}x')

# 6. HTML structural sanity
for tag in ['div','section','article','aside','header','footer','main','form','table','tbody','thead','tr','td','th','label','button','fieldset','svg','symbol','span','p','h1','h2','h3','h4','pre','video','canvas','nav','blockquote','figure','table']:
    o = len(re.findall(rf'<{tag}[\s>]', html)); c = len(re.findall(rf'</{tag}>', html))
    if tag in ('tr','td','th','button','label','span','p','h1','h2','h3','h4','option','input','pre','blockquote','figure') and o != c:
        # template literals may open/close across concatenations — report only big gaps
        if abs(o-c) > 2: problems.append(f'unbalanced <{tag}>: {o} open / {c} close')
    elif o != c and abs(o-c) > 2:
        problems.append(f'unbalanced <{tag}>: {o} open / {c} close')

# 7. accessibility spot checks
if html.count('aria-label') < 40: problems.append('suspiciously few aria-labels')
if 'outline:3px solid var(--aqua)' not in html: problems.append('missing visible focus ring rule')
if 'prefers-reduced-motion' not in html: problems.append('reduced-motion media query missing')

print('ids defined:', len(defined), '| ids used in JS:', len(used), '| icons:', len(icons), '| i18n keys:', len(en_keys), '| t() calls:', len(tkeys))
print('PROBLEMS:', problems if problems else 'none')
sys.exit(1 if problems else 0)
