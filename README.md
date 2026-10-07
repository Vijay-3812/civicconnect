# CivicConnect

**AI-assisted civic issue reporting for Chennai & Tambaram — shipped as one self-contained HTML file.**

[![CI](https://github.com/YOUR-USERNAME/civicconnect/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR-USERNAME/civicconnect/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-22D3EE.svg)](LICENSE)
[![Single file](https://img.shields.io/badge/build-none%20required-7C3AED.svg)](index.html)
[![No backend](https://img.shields.io/badge/backend-FastAPI%20%2B%20Supabase%20ready-A3E635.svg)](docs/BACKEND.md)

![CivicConnect banner](docs/banner.png)

Citizens photograph a pothole, the app triages it with on-device AI, routes it to the right department
with an SLA clock, and the ticket only closes when there is photographic proof **and** the citizen agrees.
Everything is simulated in the browser: one HTML file, zero build step, zero backend calls.

```bash
git clone https://github.com/YOUR-USERNAME/civicconnect.git
cd civicconnect
open index.html          # macOS   (Windows: start index.html ·  Linux: xdg-open index.html)
```

> Prefer a server? `python3 -m http.server 8000` → http://localhost:8000
> Or enable **Settings → Pages → Deploy from branch → main / (root)** for a live demo at
> `https://YOUR-USERNAME.github.io/civicconnect/`.

---

## Features

| Area | What is actually implemented |
| --- | --- |
| **Report flow** | 5-step animated wizard: title + description, category cards, up to 3 photos/videos with canvas downscaling, GPS with a draggable Leaflet fallback pin, voice input (Web Speech API, `ta-IN`/`en-IN`, feature-detected), anonymous toggle for selected categories |
| **AI triage** | English **and** Tamil keyword scoring → category + department; rule-based severity 1–5; lexicon sentiment with urgency flags; spam/abuse moderation |
| **Duplicate radar** | TF-IDF cosine similarity ×0.45 + Haversine geo-decay ×0.35 (0 beyond 150 m) + category match ×0.20 → "duplicate" (≥0.65) or "possibly related" (0.5–0.65); merges by linking to the parent and converting the reporter into a supporter |
| **Explainable priority** | `30·severity/5 + 20·supporters + 15·sentiment + 15·proximity-to-critical-POI + 10·age + 10·category weight`, clamped 0–100, with a per-factor breakdown tooltip |
| **State machine** | `Submitted → Verified → Assigned → In Progress → Resolved → Closed | Reopened`. Invalid transitions are refused by the service layer; **Resolved requires an after-photo + note**; every transition is appended to `statusHistory` |
| **Roles** | Citizen, per-department Official, Admin. Enforced in the service layer (`Store.can()`), not just hidden in the UI — an official cannot touch another department's queue, a citizen cannot verify, a ticket cannot close without evidence |
| **Map** | Leaflet + OpenStreetMap, colour-coded markers (red/orange/blue/green/purple), pulsing radar on high priority, grid-based clustering, popups with upvote, category/status/search filters, "near me", and a **pure-JS density heatmap** (grid buckets → `L.circle` opacity) |
| **Dashboards** | Citizen timeline + nearby feed; Official Kanban with drag-drop that obeys the state machine (invalid drops shake + toast) and a sortable table with overdue badges; Admin impact dashboard with Chart.js doughnut/bar/line/SLA gauge, hotspot leaderboard, flagged queue and CSV export |
| **Community** | One upvote per user, follow, comments with optional evidence image, public statistics page |
| **i18n** | Full English / தமிழ் dictionary — labels, statuses, toasts, demo captions (284 keys) |
| **Accessibility** | Large-UI, high-contrast, reduced-motion and **low-bandwidth text-only** modes, ARIA labels, focus rings, keyboard-navigable kanban and comparison slider, skip link |
| **Guided demo** | One button runs the whole lifecycle end-to-end with captions: report → AI triage → duplicate match → routing → In Progress → proof upload → citizen confirms + rates → green marker + confetti |

**Seed data:** 40 complaints around Tambaram/Chennai (12.92, 80.10) covering every status, three near-duplicate
pothole reports at the Madras Christian College gate (one already merged into a supporter), two flagged spam
reports, three users per role, and five departments with SLA hours.

---

## Demo script

1. Open `index.html` — the intro draws in and you start signed in as citizen **Priya Raman**.
2. Press **Play Demo** (bottom-right) and watch the full lifecycle run itself; **Skip** stops it.
3. Or drive it manually: **Report** → describe a pothole near the MCC gate → watch the AI chips appear,
   then the "Similar issue nearby" card offering **Support this existing report** or **Submit anyway**.
4. Switch role in the top bar: as official **Anitha R.** drag cards on the board — `Submitted → In Progress`
   is refused with a shake and a toast; as **Admin** open **Impact** for charts, SLA hours, hotspots, flags and CSV.
5. Toggle **EN / தமிழ்**, the theme, and the accessibility menu (try low-bandwidth mode on the map).

---

## Repository layout

```
civicconnect/
├── index.html                  ← THE APP: generated, committed, self-contained (~350 KB)
├── build.py                    ← concatenates parts/ into index.html (and sanity-checks it)
├── parts/                      ← the source of index.html, in load order
│   ├── 01_head_styles.html        head, CDN links, design tokens, all CSS
│   ├── 02_body_shell.html         icon sprite, nav, ambient layers, mount points
│   ├── 03_utils_i18n.html         utils, EN/TA dictionary, categories, SLAs, POIs
│   ├── 04_store_seed.html         store + pub/sub, RBAC, metrics, seeded dataset
│   ├── 05_services_actions.html   AI services, actions, state machine
│   ├── 06_motion.html             GSAP orchestration, confetti, tilt, FLIP, particles
│   ├── 07_components_map.html     shared components, Leaflet map module
│   ├── 08_views_core.html         landing, auth, report wizard
│   ├── 09_views_dashboards.html   map view, detail view, citizen/official/admin/stats
│   └── 10_app_demo_boot.html      router, app shell, guided demo, boot
├── tools/
│   ├── audit.py                   static audit of the built file
│   ├── test_services.js           78 assertions: AI, duplicates, state machine, RBAC, i18n
│   └── test_views.js              35 assertions: boot, 25 routes/roles/langs, guided demo
└── docs/
    ├── BACKEND.md              how to replace every mock with FastAPI + Supabase + Gemini
    └── PUSH.md                 how to publish this repo to GitHub
```

Edit anything under `parts/`, then rebuild:

```bash
python3 build.py            # writes index.html
python3 tools/audit.py      # static checks (ids, icons, i18n keys, no leftovers)
node tools/test_services.js # service-layer + state-machine tests
node tools/test_views.js    # boots the app in a stub DOM, renders every route, runs the demo
```

All four commands are green in CI on every push, and CI fails if `index.html` is out of date with `parts/`.
No dependencies: the tests use only Node and Python's standard library.

---

## How the AI services map to a real backend

Every service is a **pure function returning a plain object** — swap the body, keep the shape:

| Client function | Replace with | Suggested stack |
| --- | --- | --- |
| `Services.classifyCategory` | `POST /v1/classify` | FastAPI + Gemini 1.5 Flash (bilingual prompt) |
| `Services.estimateSeverity` | `POST /v1/severity` | Gemini function-calling with POI context |
| `Services.sentimentScore` | `POST /v1/sentiment` | sentence-transformers / IndicBERT head |
| `Services.moderate` | `POST /v1/moderate` | classifier + spam rules |
| `Services.detectDuplicates` | `POST /v1/duplicates` | pgvector embeddings + PostGIS `ST_DWithin(geog, pt, 150)` |
| `Services.priorityScore` | `POST /v1/priority` | same weights, POIs from a `pois` table |
| `Services.summarizeForOfficials` | `POST /v1/summary` | Gemini over the filtered rows |
| `Store.Auth` | Supabase Auth | `profiles(id, role, department_id)` |
| `Store.addComplaint` / actions | `supabase.from('complaints')` | Row-level security per role + department |
| `Store.notify` | Supabase Realtime | `postgres_changes` channel |
| Media dataURLs | `storage.from('complaint-media')` | Supabase Storage |

Full DDL, RLS policies, a FastAPI router sketch and the cron SLA job are in **[docs/BACKEND.md](docs/BACKEND.md)**.

---

## Notes & limitations

- All state is in memory. `localStorage` is used only for theme/language/accessibility preferences and is
  wrapped in `try/catch` — it degrades to a no-op instead of throwing.
- Map tiles come from OpenStreetMap. If they are blocked (offline, strict CSP), the map falls back to a
  stylised grid and the app stays fully functional — markers still render over the fallback.
- Media never leaves the browser: uploads are read as data URLs and downscaled on a canvas.
- Tamil translations were written for this demo and should be reviewed by a native speaker before production use.
- Runtime dependencies are loaded from cdnjs (Leaflet 1.9.4, GSAP 3.12.5 + ScrollTrigger, Chart.js 4.4.1) and
  Google Fonts (Sora + Inter). Every one of them is feature-detected; the app works without any of them.

## Credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors · tiles via Leaflet ·
animation via GSAP · charts via Chart.js · type: Sora & Inter.
Inspired by SDG 11 (sustainable cities) and SDG 16 (strong institutions).

## License

MIT — see [LICENSE](LICENSE). Replace the demo data with real complaints ethically: this is civic infrastructure,
not a toy.
