# Swapping the mocks for a real backend

CivicConnect ships as a single HTML file with everything simulated client-side. This document maps each
simulated service to a production stack — **FastAPI + Supabase (PostgreSQL + PostGIS, Auth, Storage, Realtime)
+ Gemini / sentence-transformers** — so the UI does not have to be rewritten.

The guiding rule: every service in `parts/05_services_actions.html` is a **pure function returning a plain
object**. Replace the body with a `fetch()`, keep the return shape, and every view keeps working. The same is
true for `Store` (reads) and `Actions` (writes).

---

## 1. Service → endpoint map

| Client-side (now) | Endpoint (production) | Returns |
| --- | --- | --- |
| `Services.classifyCategory(text, imageMeta)` | `POST /v1/classify` | `{ category, confidence, department, scores }` |
| `Services.estimateSeverity(text, category, location)` | `POST /v1/severity` | `{ severity, signals[] }` |
| `Services.sentimentScore(text)` | `POST /v1/sentiment` | `{ score, urgent, urgentSignals[] }` |
| `Services.moderate(text)` | `POST /v1/moderate` | `{ flagged, reasons[], spamScore }` |
| `Services.detectDuplicates(report, existing)` | `POST /v1/duplicates` | `{ matches[], candidate, verdict }` |
| `Services.priorityScore(complaint)` | `POST /v1/priority` | `{ score, parts{} }` |
| `Services.summarizeForOfficials(list)` | `POST /v1/summary` | `{ text }` |
| `Store.Auth.login / register` | Supabase Auth | session + `profiles` row |
| `Store.addComplaint`, `Actions.*` | `supabase.from('complaints')` | row |
| `Store.notify()` | Supabase Realtime channel | `postgres_changes` events |
| `draft.media` data URLs | `storage.from('complaint-media')` | public URL |

Keep the deterministic implementations as **fallbacks**: if the API is unreachable, classify locally and flag
the complaint for review. That is already how the offline tile fallback works for the map.

---

## 2. Database schema (PostgreSQL + PostGIS)

```sql
create extension if not exists postgis;
create extension if not exists pgcrypto;      -- gen_random_uuid()
create extension if not exists vector;        -- duplicate detection

create type complaint_status as enum
  ('Submitted','Verified','Assigned','In Progress','Resolved','Closed','Reopened');

create table departments (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  head         text,
  email        text,
  phone        text,
  ward         text,
  categories   text[] not null default '{}'
);

create table categories (                       -- SLA hours live here (admin-editable)
  id           text primary key,                -- 'road damage', 'waste', ...
  department_id uuid references departments(id),
  sla_hours    numeric not null check (sla_hours > 0),
  weight       numeric not null default 1.0,    -- priority model
  anon_allowed boolean not null default false
);

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null,
  role          text not null check (role in ('citizen','official','admin')),
  department_id uuid references departments(id),
  banned        boolean not null default false,
  created_at    timestamptz not null default now()
);

create table complaints (
  id             text primary key,                     -- 'CC-1001' style, or uuid + display_id
  title          text not null check (char_length(title) between 8 and 140),
  description    text not null check (char_length(description) >= 20),
  category       text not null references categories(id),
  severity       smallint not null check (severity between 1 and 5),
  priority_score smallint not null check (priority_score between 0 and 100),
  priority_parts jsonb,                                -- the explainable breakdown
  department_id  uuid not null references departments(id),
  status         complaint_status not null default 'Submitted',
  geog           geography(Point, 4326) not null,      -- PostGIS point
  address        text,
  reporter_id    uuid references profiles(id),
  anonymous      boolean not null default false,
  sentiment      numeric,
  assigned_to    text,
  moderation     jsonb,
  removed        boolean not null default false,
  created_at     timestamptz not null default now(),
  sla_due_at     timestamptz not null,
  embedding      vector(384)                           -- sentence-transformers output
);

create index complaints_geog_idx  on complaints using gist (geog);
create index complaints_dept_idx  on complaints (department_id, status);
create index complaints_open_idx  on complaints (sla_due_at) where status not in ('Closed','Resolved');
create index complaints_fts_idx   on complaints using gin (to_tsvector('simple', title || ' ' || description));

create table complaint_media   (id uuid primary key default gen_random_uuid(),
                                complaint_id text references complaints(id) on delete cascade,
                                url text not null, kind text not null check (kind in ('image','video','after')),
                                uploaded_by uuid references profiles(id), created_at timestamptz default now());

create table supporters        (complaint_id text references complaints(id) on delete cascade,
                                user_id uuid references profiles(id) on delete cascade,
                                created_at timestamptz default now(), primary key (complaint_id, user_id));

create table followers         (complaint_id text references complaints(id) on delete cascade,
                                user_id uuid references profiles(id) on delete cascade,
                                created_at timestamptz default now(), primary key (complaint_id, user_id));

create table comments          (id uuid primary key default gen_random_uuid(),
                                complaint_id text references complaints(id) on delete cascade,
                                user_id uuid references profiles(id), body text not null,
                                image_url text, created_at timestamptz default now());

create table status_history    (id bigserial primary key,
                                complaint_id text references complaints(id) on delete cascade,
                                status complaint_status not null,
                                by_user uuid references profiles(id),
                                note text, at timestamptz not null default now());

create table resolutions       (complaint_id text primary key references complaints(id) on delete cascade,
                                after_photo_url text, note text,
                                at timestamptz, confirmed boolean, rating smallint check (rating between 1 and 5));

create table flags             (id uuid primary key default gen_random_uuid(),
                                complaint_id text references complaints(id) on delete cascade,
                                by_user uuid references profiles(id), reason text, status text default 'open');

create table pois              (id serial primary key, name text, type text,
                                geog geography(Point,4326) not null);   -- schools, hospitals, main roads
create index pois_geog_idx on pois using gist (geog);

-- SLA clock: set on insert, recomputed when an admin edits categories.sla_hours
create or replace function set_sla() returns trigger as $$
begin
  select now() + (c.sla_hours || ' hours')::interval into new.sla_due_at
  from categories c where c.id = new.category;
  return new;
end $$ language plpgsql;
create trigger complaints_set_sla before insert on complaints
  for each row execute function set_sla();
```

---

## 3. Row-level security (RBAC in the database, not just the UI)

```sql
alter table complaints enable row level security;

-- helper: current user's role + department
create or replace function my_role() returns text
  language sql stable as $$ select role from profiles where id = auth.uid() $$;
create or replace function my_dept() returns uuid
  language sql stable as $$ select department_id from profiles where id = auth.uid() $$;

-- Citizens (and guests) read public, non-removed complaints
create policy complaints_public_read on complaints for select
  using (removed = false);

-- Officials read only their own department's queue
create policy complaints_official_read on complaints for select
  using (my_role() in ('official','admin') and (my_role() = 'admin' or department_id = my_dept()));

-- Citizens create reports for themselves (guests are not allowed in production)
create policy complaints_insert on complaints for insert
  with check (auth.uid() = reporter_id or (anonymous and category in (select id from categories where anon_allowed)));

-- Only the owning department (or an admin) can update status/assignment
create policy complaints_update on complaints for update
  using (my_role() = 'admin' or (my_role() = 'official' and department_id = my_dept()));
```

The **state machine and the evidence rule belong in a trigger**, so a buggy client cannot bypass them:

```sql
create or replace function enforce_transitions() returns trigger as $$
declare allowed complaint_status[];
begin
  allowed := case old.status
    when 'Submitted'   then array['Verified','Reopened']::complaint_status[]
    when 'Verified'    then array['Assigned']::complaint_status[]
    when 'Assigned'    then array['In Progress']::complaint_status[]
    when 'In Progress' then array['Resolved']::complaint_status[]
    when 'Resolved'    then array['Closed','Reopened']::complaint_status[]
    when 'Closed'      then array['Reopened']::complaint_status[]
    when 'Reopened'    then array['Assigned']::complaint_status[]
  end;

  if new.status <> old.status and not (new.status = any(allowed)) then
    raise exception 'illegal transition % -> %', old.status, new.status;
  end if;

  -- "Resolved" requires an after photo AND a note, uploaded by the department
  if new.status = 'Resolved' then
    if not exists (select 1 from resolutions r
                   where r.complaint_id = new.id and r.after_photo_url is not null
                     and coalesce(btrim(r.note),'') <> '') then
      raise exception 'resolution needs an after-photo and a note';
    end if;
  end if;

  insert into status_history (complaint_id, status, by_user, note)
  values (new.id, new.status, auth.uid(), coalesce(new.moderation->>'note',''));
  return new;
end $$ language plpgsql security definer;
create trigger complaints_transitions before update on complaints
  for each row execute function enforce_transitions();
```

**SLA sweep** (pg_cron) — mirrors the client's overdue badges:

```sql
select cron.schedule('sla-sweep', '*/15 * * * *', $$
  update complaints set status = status            -- touch rows for realtime fan-out
  where status not in ('Closed','Resolved') and sla_due_at < now() - interval '1 hour';
$$);
```

---

## 4. Storage + Realtime

```sql
-- bucket for before/after evidence and comment images
insert into storage.buckets (id, name, public) values ('complaint-media','complaint-media', true);
-- citizens may upload into their own folder; only moderators may delete
create policy media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'complaint-media');
```

Client-side, replace `draft.media` data URLs with:

```js
const { data, error } = await supabase.storage
  .from('complaint-media')
  .upload(`${userId}/${crypto.randomUUID()}.jpg`, blob, { contentType: 'image/jpeg' });
const url = supabase.storage.from('complaint-media').getPublicUrl(data.path).data.publicUrl;
```

Notifications become a Realtime subscription instead of the in-memory `Store.notify()`:

```js
supabase.channel('complaints')
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'complaints' },
      (payload) => Store.applyRemote(payload.new))   // patch the store, re-render via pub/sub
  .subscribe();
```

---

## 5. FastAPI sketch for the AI services

```python
# app/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Literal

app = FastAPI(title="CivicConnect API", version="1.0")

CATEGORIES = ["road damage", "waste", "drainage", "water", "streetlight", "public safety"]

class ClassifyIn(BaseModel):
    text: str = Field(min_length=3, max_length=2000)
    image_hint: str | None = None

class ClassifyOut(BaseModel):
    category: Literal[*CATEGORIES] | None
    confidence: float
    department: str | None
    scores: dict[str, float]

@app.post("/v1/classify", response_model=ClassifyOut)
async def classify(payload: ClassifyIn):
    # 1) deterministic keyword scorer (same dictionaries as the client) as a fast path / fallback
    # 2) Gemini 1.5 Flash with a bilingual (English + Tamil) system prompt for the long tail
    result = await gemini_classify(payload.text, payload.image_hint)
    if result is None:                                      # model down → degrade, never 500
        result = keyword_classify(payload.text)
    return result

class SeverityIn(BaseModel):
    text: str
    category: str
    lat: float
    lng: float

@app.post("/v1/severity")
async def severity(payload: SeverityIn):
    poi = await nearest_poi(payload.lat, payload.lng, radius_m=200)   # PostGIS ST_DWithin
    return await gemini_severity(payload.text, payload.category, poi)

@app.post("/v1/duplicates")
async def duplicates(payload: ReportIn):
    # 1) cheap radius filter in Postgres, then cosine on embeddings
    rows = await db.fetch("""
        select c.id, c.title, c.category,
               1 - (c.embedding <=> $1::vector) as text_similarity,
               st_distance(c.geog, st_makepoint($2,$3)::geography) as metres
        from complaints c
        where c.removed = false
          and st_dwithin(c.geog, st_makepoint($2,$3)::geography, 150)
        order by c.embedding <=> $1::vector
        limit 10
    """, embed(payload.text), payload.lng, payload.lat)
    scored = [{
        **r,
        "geo": 0 if r["metres"] > 150 else pow(2.718, -r["metres"] / 150),
        "category": 1 if r["category"] == payload.category else 0,
    } for r in rows]
    for s in scored:
        s["score"] = 0.45 * s["text_similarity"] + 0.35 * s["geo"] + 0.20 * s["category"]
        s["verdict"] = "duplicate" if s["score"] >= 0.65 else "related" if s["score"] >= 0.5 else "distinct"
    return {"matches": [s for s in scored if s["verdict"] != "distinct"]}
```

Run it with `uvicorn app.main:app --reload`, deploy on Fly.io / Render / Cloud Run, and point the client at it:

```js
// parts/05_services_actions.html
const API_BASE = window.CIVIC_API || '';           // '' = stay fully local
async function classifyCategoryRemote(text, imageMeta) {
  if (!API_BASE) return classifyCategory(text, imageMeta);
  try {
    const r = await fetch(API_BASE + '/v1/classify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, image_hint: imageMeta && imageMeta.hint })
    });
    if (!r.ok) throw new Error(r.status);
    return await r.json();                          // same shape as the local function
  } catch (e) {
    return classifyCategory(text, imageMeta);       // offline / quota exhausted → local model
  }
}
```

Keep the local implementation forever: it is the fallback, it is free, and for the six categories in this
project it is accurate enough to triage most reports.

---

## 6. Production checklist

- [ ] Supabase Auth: email OTP or phone OTP (citizens), email + password (officials, admins).
- [ ] Rate limit report creation (e.g. 5/hour per user) and media uploads (10 MB, 3 files) at the API layer.
- [ ] Anonymous reports: store `reporter_id` but never expose it through the public API; strip EXIF GPS from
      uploads client-side (the canvas re-encode in `Utils.downscaleImage` already drops metadata).
- [ ] Moderation: queue flagged items for admins, keep the automated `moderate()` result in the row.
- [ ] Backups + PITR on the Postgres project; export analytics to CSV or a read replica for dashboards.
- [ ] Observability: log every model call with latency + fallback usage; alert when the fallback rate >20%.
- [ ] Data protection: define retention for photos (e.g. 24 months) and honour deletion requests.
- [ ] Load the POI table from OpenStreetMap (`amenity=school|hospital|college`, `highway=trunk|primary`)
      so `priorityScore`'s proximity factor is not a hard-coded list.
- [ ] Replace the header comment in `index.html` with a version string and keep `build.py` in CI.
