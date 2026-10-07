# Contributing to CivicConnect

Thanks for helping. This project has one unusual rule: **`index.html` is a generated file.**
Edit `parts/`, rebuild, and commit both.

## Setup (no dependencies)

You need Node 18+ and Python 3.9+ — nothing else. There is no `npm install`, no bundler, no framework.

```bash
git clone https://github.com/YOUR-USERNAME/civicconnect.git
cd civicconnect
python3 build.py             # regenerate index.html from parts/
python3 -m http.server 8000  # http://localhost:8000
```

## The workflow

```bash
# 1. edit one or more files under parts/ (they are concatenated in filename order)
# 2. rebuild + verify
python3 build.py
python3 tools/audit.py       # static checks: missing ids/icons/i18n keys, leftover debug code
node tools/test_services.js  # AI, duplicates, state machine, RBAC, i18n
node tools/test_views.js     # boots the app in a stub DOM, renders every route, runs the guided demo
# 3. commit the source AND the rebuilt file
git add parts/ index.html && git commit -m "feat(map): cluster markers above zoom 14"
```

CI runs exactly those four commands and fails if `index.html` is stale, so always rebuild before pushing.

## Where things live

| You want to change… | Edit |
| --- | --- |
| Colours, spacing, themes, accessibility modes | `parts/01_head_styles.html` |
| Text, labels, a new language | `parts/03_utils_i18n.html` (dictionary) — every string goes through `t()` |
| Categories, SLA hours, departments, POIs, seed data | `parts/03_utils_i18n.html` and `parts/04_store_seed.html` |
| An AI service (classification, severity, duplicates, priority) | `parts/05_services_actions.html` |
| Animations, confetti, tilt, FLIP transitions | `parts/06_motion.html` |
| Map behaviour, popups, heatmap | `parts/07_components_map.html` |
| A screen or dashboard | `parts/08_views_core.html` / `parts/09_views_dashboards.html` |
| Routing, nav, guided demo | `parts/10_app_demo_boot.html` |

## House rules

1. **Keep service signatures stable.** `Services.*` are pure functions returning plain objects; if you replace
   one with a `fetch()` to a real model, keep the same return shape so the UI keeps working.
2. **Enforce permissions in the service layer, not only in the UI.** Use `Store.can(action, complaint)` and
   the `TRANSITIONS` table. Hidden buttons are not security.
3. **Never bypass the state machine.** New statuses/changes go into `TRANSITIONS` and must be appended to
   `statusHistory`.
4. **All user-visible strings go through `t()`** and must exist in both `en` and `ta`.
5. **Accessibility is not optional:** labels on inputs, `aria-label` on icon buttons, keyboard support for
   interactive elements, visible focus, and honour the reduced-motion / low-bandwidth flags.
6. **No new runtime dependencies** unless you also add a graceful fallback — the app must still work when the
   CDN is unreachable (that is the point of the single-file design).
7. **Escape user data.** Use `Utils.escapeHtml()` for anything that reaches the DOM.

## Adding a language

Copy the `en` block in `parts/03_utils_i18n.html` into a new locale, translate the values, add it to the
language `segment()` items in `parts/10_app_demo_boot.html`, and add a test case in `tools/test_services.js`
(the existing check "Tamil dictionary covers every English key" is a good template).

## Reporting bugs

Open an issue with: what you did, what you expected, what happened, and your browser + OS. If it is a UI issue,
a screenshot helps — the demo has no hidden state, so the exact click path is usually enough to reproduce.

## Code of conduct

Be decent. This is software for public infrastructure; the people using it are neighbours, not users.
