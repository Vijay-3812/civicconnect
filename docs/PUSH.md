# Publishing this repo to GitHub

Three routes, fastest first. Pick one — you only need to do this once.

The repository is already a git repo with history (four commits) and CI configured. Nothing in this folder
needs to be rebuilt before pushing: `index.html` is committed and the four checks in `.github/workflows/ci.yml`
already pass locally.

---

## Route A — I downloaded the zip (keeps history, recommended)

```bash
# 1. Unzip the bundle somewhere sensible
unzip civicconnect-github.zip -d ~/projects
cd ~/projects/civicconnect

# 2. Make the commits yours (they are currently authored as "CivicConnect")
git config user.name  "Your Name"
git config user.email "you@example.com"
git rebase --root --exec 'git commit --amend --no-edit --reset-author'

# 3. Create an empty repo on github.com — name it `civicconnect`, do NOT add a README/license
#    (the repo already has both)

# 4. Point it at your new repo and push (the branch is already named main)
git remote add origin https://github.com/YOUR-USERNAME/civicconnect.git
git push -u origin main
```

When git asks for a password, paste a **Personal Access Token**, not your GitHub password
(Settings → Developer settings → Personal access tokens → Fine-grained → Repository access: your repo →
Permissions: Contents = Read and write). On macOS the keychain remembers it; on Windows use Git Credential Manager.

**SSH instead of HTTPS:**

```bash
ssh-keygen -t ed25519 -C "you@example.com"     # if you do not have a key yet
cat ~/.ssh/id_ed25519.pub                      # paste into GitHub → Settings → SSH keys
git remote set-url origin git@github.com:YOUR-USERNAME/civicconnect.git
git push -u origin main
```

---

## Route B — GitHub CLI (one command)

```bash
cd ~/projects/civicconnect
gh auth login
gh repo create civicconnect --public --source=. --remote=origin --push
```

---

## Route C — no git at all (web upload)

1. On github.com: **New repository** → name `civicconnect` → Public → **Create**.
2. **Add file → Upload files**, then drag the *contents* of the `civicconnect` folder in
   (`index.html`, `parts/`, `tools/`, `docs/`, `README.md`, `LICENSE`, `.github/`).
   GitHub's web uploader keeps folder structure if you drag folders.
3. Commit. You lose the prepared history, and CI will fail the "index.html up to date" step only if the file
   drifts from `parts/` — so keep editing `parts/` and running `python3 build.py` afterwards.

Note: the web uploader cannot create dotfiles by dragging; create `.gitignore` and `.github/workflows/ci.yml`
manually via **Add file → Create new file** if you take this route.

---

## After the first push (2 minutes of housekeeping)

1. **Replace the badge placeholders** — in `README.md`, swap `YOUR-USERNAME` for your GitHub username
   (two occurrences: the CI badge and the clone URL, plus the demo link below).
2. **Publish a live demo** — Settings → Pages → *Deploy from a branch* → `main` / `(root)` → Save.
   `index.html` is at the repo root, so the app goes live at
   `https://YOUR-USERNAME.github.io/civicconnect/` in a minute or two.
3. **Repo description + topics** — suggested: *"AI-assisted civic issue reporting for Chennai: duplicate
   detection, SLA tracking and evidence-gated closure — one self-contained HTML file."*
   Topics: `civic-tech`, `openstreetmap`, `leaflet`, `vanilla-javascript`, `single-file`, `civic-engagement`,
   `tamil`, `sdg11`, `postgis`, `fastapi`.
4. **Check CI** — the Actions tab should show a green run within a minute of the first push.

---

## Verify before you push (optional, 40 seconds)

```bash
python3 build.py             # rebuild from parts/ (should report PROBLEMS: none)
python3 tools/audit.py
node tools/test_services.js  # 78 passed, 0 failed
node tools/test_views.js     # 35 passed, 0 failed
git status --short           # should be clean — if index.html changed, commit it
```

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Authentication failed` on push | Use a Personal Access Token (or SSH), not your account password. |
| `src refspec main does not match any` | You are on a different branch: `git branch --show-current`, then `git branch -M main` and push again. |
| `updates were rejected … non-fast-forward` | The remote has commits you do not: `git pull --rebase origin main` then push. |
| `fatal: not a git repository` | You are inside the unzipped folder but the `.git` directory is missing — Route C, or re-download the zip. |
| CI fails: *index.html is out of date* | You edited `parts/` but did not run `python3 build.py`. Rebuild and commit `index.html` too. |
| CI fails: `PROBLEMS: [...]` from audit | Read the list — usually a `t()` key or icon `id` typo, or a `TODO` left behind. |
| Pages shows a 404 | Give it a minute, confirm the branch is `main` and the folder is `/(root)`, and that `index.html` is committed. |
| Want the commits under a different email | `git rebase --root --exec 'git commit --amend --no-edit --reset-author'` after setting `user.email`. |

---

## What gets pushed

```
index.html       349 KB  ← the whole app: HTML + CSS + JS, no build step to run it
parts/ (10 files)         ← the editable source
tools/ (3 files)          ← audit + 113 automated assertions
docs/                     ← this file, BACKEND.md, the banner
build.py, README.md, LICENSE, CONTRIBUTING.md, .gitignore, .github/
```

If you would rather publish only the app, you can push a second repo containing just `index.html` — but keep
the source repo too, otherwise nobody (including future you) can maintain it.
