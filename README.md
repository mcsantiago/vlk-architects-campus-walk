# Campus Walk

A phone-first app for the campus walk an architect does at the start of a facilities assessment: open the room you are standing in, record what is in it (photo, type, quantity, condition, note), mark the room walked, and let the office watch the campus summary fill in.

Take-home for the VLK Senior Full Stack Engineer role. Status as of 2026-10-14:

| From the brief | Status |
|---|---|
| Field: browse campus → building → floor → room; add, move, rate, photo and note an asset | Done |
| Office: counts by type, items in poor condition, rooms not yet walked | Done |
| Building-level systems (rooftop HVAC) | Done: assets live at building, floor or room level ([data model](#data-model)) |
| One fictional campus, a few buildings, ≥30 rooms | Done: Live Oak K-8, 4 buildings, 36 rooms; the sample district VLK supplied loads alongside |
| Frontend, API, persistent storage, tests, runs locally | Done: React, Hono, Postgres; 75 API tests |
| Stretch: two walkers at once | Done (version checks, 409 with the other walker's changes) |
| Stretch: CSV import/export | Done (rooms import, assets and rooms export, plus a district inventory import) |
| Stretch: AI type/condition from a photo | Partly: written and tested with a fake model, never run against Bedrock (no account access) |
| Stretch: offline | Not done ([What's next](#whats-next)) |
| Deployed URL | Not deployed: the CDK stack is written and synthesises, never deployed ([Deploying](#deploying-written-not-exercised)) |

- [Run it locally](#run-it-locally)
- [Walk through it](#walk-through-it)
- [Data model](#data-model)
- [How it's built](#how-its-built)
- [Key decisions and trade-offs](#key-decisions-and-trade-offs)
- [Testing](#testing)
- [AI usage](#ai-usage)
- [What's next](#whats-next)

Deeper docs: [`docs/data-model.md`](docs/data-model.md) (tables, ER diagram, modelling decisions), [`docs/decisions.md`](docs/decisions.md) (decisions and trade-offs in full), [`docs/architecture.md`](docs/architecture.md) (system diagrams, request lifecycles), [`docs/api.md`](docs/api.md) (every endpoint with request, response and error shapes), [`Project Scope.md`](Project%20Scope.md) (the plan this was built against).

## Run it locally

Needs Node 22+ and Docker. One campus is seeded with 4 buildings, 36 rooms, two walkers' worth of progress and ~100 assets so the summary is not empty, and the sample district VLK supplied with the brief can be loaded next to it.

```bash
npm install
cp .env.example .env            # defaults match docker-compose
docker compose up -d            # Postgres 16 + RustFS (S3-compatible) with the photos bucket created
npm run db:migrate
npm run db:seed                 # Live Oak K-8 (also runs migrations)
npm run db:import-sample        # Cedar Ridge ISD from data/sample: 2 campuses, 177 rooms, 838 asset records
npm run dev                     # API on http://localhost:3000
npm run dev:web                 # web on http://localhost:5173 (also on your LAN IP for a phone)
```

`db:import-sample` loads a district's existing inventory (`data/sample/*.csv`, or a directory you pass) as the starting point for a walk, which is how a real engagement starts: the walk verifies what is on the books rather than building the list from nothing. Rated rows keep their rating, the person who gave it and the date; rows in rooms nobody has reached yet come in as **not rated**, and the office summary counts them. Nothing is attributed that the files do not say: they record when a room was walked but not by whom, so imported walks are credited to the district import rather than to whichever architect rated most of the room. Source ids (campus, building, floor, room, type, asset) and asset tags must be unique, as must floor levels and room numbers within their parent; a repeat is refused with both line numbers rather than letting the last row silently re-point everything that refers to it. Room types are stored as the district wrote them, categories are normalised onto ours (anything unrecognised becomes equipment, with a note), only the columns needed to place a row are required and extra columns are ignored, so another district's files need no code change. Everything is validated first and written in one transaction; a campus already in the database is skipped.

No Docker? Set `DATABASE_URL=pglite://.data/pg` in `.env` for embedded Postgres; photos then live in memory until restart.

**The AI photo suggestion is written but has not been run against a real model.** I had no Bedrock access for this submission, so it is exercised only through a fake suggester in the tests (see [AI usage](#ai-usage)). It is off unless `BEDROCK_MODEL` is set (see `.env.example`), and then uses the default AWS credential chain and a Bedrock-enabled region. Everything else works without it; the add-asset form just opens empty.

**From a phone on the same Wi-Fi:** open the LAN URL Vite prints (`http://<laptop-ip>:5173`). Nothing else to set: the web app calls the API at `/api` on its own origin, Vite proxies that to the API, and the API presigns photo URLs for whatever host the request came from, so the phone's uploads go to `http://<laptop-ip>:9000` rather than `localhost`. The camera needs a secure context on iOS; `localhost` and plain `http://` on a LAN address both work in Safari for the file picker, but if the camera option is missing, tunnel it (`npx localtunnel --port 5173`) and set `S3_PUBLIC_ENDPOINT` to a tunnel for port 9000.

## Deploying (written, not exercised)

Cloud deployment was descoped for this submission in favour of the workflow, the code and the data model; the stack is included to show the intended production shape. One CDK stack in `infra/`: CloudFront + S3 for the web app, ECS Fargate behind an ALB for the API, RDS Postgres (t4g.micro), S3 for photos, Bedrock through the task role, Secrets Manager for the database credentials. About $40 a month at demo size, most of it the ALB and RDS; there is no NAT gateway because the single task runs in a public subnet with a public IP.

What has been verified: the stack synthesises cleanly (64 resources), the API image builds from `apps/api/Dockerfile`, and that image was run against Postgres with the split credentials the task receives, where it migrated, seeded the empty database and served requests. What has not: an actual `cdk deploy`. The CloudFront Function, the ALB header rule and the Bedrock policy have not met a real account yet, so expect a short iteration there.

```bash
npx -w infra cdk bootstrap aws://<account>/<region>   # once per account and region; needs AWS credentials and Docker
CAMPUS_WALK_ACCESS_CODE=<code> npm run deploy          # builds the web app, builds and pushes the API image, deploys
```

The stack prints the CloudFront URL. The first visit on each device asks for the access code, checked by a CloudFront Function that sets a 30-day cookie; the same function forwards `/api/*` to the ALB without the prefix and refuses API calls without the cookie. The ALB only accepts requests carrying a header CloudFront adds, so there is no way around the gate. On start the API applies migrations and, if the database is empty, seeds the demo campus. Photo suggestions need model access enabled in Bedrock for the model in `infra/cdk.json` (`-c bedrockModel=` overrides it). `npm run destroy -w infra` removes everything, buckets and database included.

## Walk through it

**Field (phone):**

1. **Who's walking today?** Enter your name. No login yet; the name goes on every room you mark and every change you make (see [What's next](#whats-next) for real authentication).
2. **Projects.** Every campus you can walk: Live Oak K-8 from the seed, and Bluebonnet Elementary and Cedar Ridge High School from the sample import.
3. **Campus.** Address, principal's contact (tap to call or email), walk progress, and the list of buildings.
4. **Building.** Address and site contact, a **Building systems** entry for assets with no room (rooftop units, corridor panels), and a floor dropdown that filters the rooms. The floor with the next unwalked room is selected first.
5. **Room.** Walk status, a grid of photos of the room itself (add from the camera or the photo library), and the assets in the room. Each row opens the asset and has **Edit**, **Copy** (to any room, floor or building level) and **Delete** (with confirmation). **Add asset** is the primary action.
6. **Add asset.** Photo first: it is resized on the phone and uploaded straight to object storage. With Bedrock configured it is also sent to Claude to propose the type, condition and a one-line note (written, not exercised against a live model; locally the form opens empty). Fill in or fix the fields, set the quantity (furniture is counted; technology, equipment and systems are one record each), pick a condition from five big buttons, save. **What is it?** searches the shared catalogue as you type; if the thing in front of you is not in it, add it right there (name, category, counted or one-per-unit; if the name looks like one already there, "RTU" for Rooftop HVAC Unit, it asks "Did you mean" first) and it is available to every walker, and to the photo suggestion, from then on. Category belongs to the type, so **Change…** under a chosen type recategorises every asset of that type at once (projectors from equipment to technology, say), after a confirmation that spells out that it changes the catalogue for every campus.
7. **Asset.** The photo large (tap for the photo screen), the facts (including make, model, serial and install year when the district's inventory had them), and Edit / Move / Copy / Delete plus the full history. An imported asset nobody has rated yet says so; editing it asks for a condition. **Edit** is its own screen; if someone else saved the same asset first you see who, what they changed, and can load their version before re-applying yours.
8. **Photo.** One photo full-width with what it is of and the model's note if there was one.
9. **Mark room walked** sends you back to the building with the next room highlighted. If imported assets in the room are still not rated, the room says how many, and marking it walked asks first ("Mark walked anyway" is there for items that could not be reached); a walked room with unrated assets keeps showing the count.

**Office (laptop):** the campus summary at `/c/<campus>/summary`, a two-column dashboard on a desk and a single column on a phone: rooms walked and headline numbers (including how many imported assets are still unrated), then rooms not yet walked grouped by building and floor (the office's first question, so it is first), assets in poor condition linking to the record, counts by type (sum of quantity; the top eight, with a toggle for the rest), a building filter, CSV export of assets and rooms, and CSV import of rooms (the rooms export is the template).

## Data model

Campus → Building → Floor → Room is the floor plan, known before the walk. An asset always has a building and optionally a floor and a room, so a rooftop unit is a building-level asset and a corridor fire panel a floor-level one, with no fake rooms. Furniture is counted with a `quantity`; technology, equipment and systems are one record each. Condition is 1–5, or empty for an imported item nobody has rated yet. Categories are rows in a table, not an enum. Every change writes a history event, and deletes are soft.

The database enforces the location rules (composite foreign keys make a room on the wrong floor impossible to store). Tables, the full diagram and the reasoning: [`docs/data-model.md`](docs/data-model.md).

## How it's built

```
apps/api         Hono on Node 22 · Drizzle ORM · Postgres (PGlite in tests) · S3 presigned uploads · Bedrock
apps/web         React 19 · Vite · TanStack Query · React Router · plain CSS, phone-first
packages/shared  zod request schemas, response types and domain constants used by both
infra/           AWS CDK stack (CloudFront + S3, ALB + Fargate, RDS, S3 photos, Bedrock) and the edge gate function
docker/          RustFS bucket CORS
docs/            architecture diagrams, API contract
```

| Concern | Choice | Notes |
|---|---|---|
| API | [Hono](https://hono.dev) | Web-standard `Request`/`Response`; tests call the app in-process with no server. Same code would run on Lambda or Workers. |
| Validation | zod 4 | One schema per request body, shared with the web form types. 400s carry the issues. |
| Database | Postgres 16 + Drizzle | Migrations generated from the TS schema. Constraints enforce the location rules below. |
| Tests | vitest + PGlite | In-memory Postgres per test file; `TEST_DATABASE_URL` runs the same tests on real Postgres. |
| Photos | S3 presigned PUT/GET | The phone talks to storage directly; the API never proxies image bytes. RustFS locally, S3 on AWS. |
| AI | Claude on Amazon Bedrock | Written, not exercised against a live model. Structured output parsed into a zod schema; refusal, malformed output or an error degrade to "no suggestion". |
| Web | React + Vite | ~150 KB gzipped. Installable manifest; a service worker is the next step for offline. |

## Key decisions and trade-offs

The reasoning for each is in [`docs/decisions.md`](docs/decisions.md).

- **Rooms come from the floor plan, not the field.** Walkers assign assets to rooms that already exist (seed, rooms CSV import, or the district's inventory); they never create rooms.
- **Identity without authentication, on purpose for now.** The walker picks a name, and it goes on every change and every walked room. It is an audit trail, not security: anyone who can reach the API can write as anyone. Real login is item 3 in [What's next](#whats-next).
- **Two walkers at once via version checks, not sync.** A stale save gets a 409 with the other walker's record, and the UI offers their version. Chosen over CouchDB/PouchDB replication, which would have replaced most of the API and still needed a conflict screen.
- **Photos go straight from the phone to S3.** The API mints the key and checks the bytes, never proxies the image. Room and asset photos sit under separate prefixes for later labelling. Abandoned uploads are left behind for now (a cleanup job is in What's next).
- **Walkers can add asset types in the field.** Stopping a walk to ask the office costs more than the odd extra type. A "Did you mean" prompt catches lookalikes (RTU vs Rooftop HVAC Unit); real synonyms need curated aliases (What's next, item 2).
- **Category changes are global.** Recategorising a type moves every asset of it, everywhere, behind an explicit confirmation; it is not yet versioned or role-restricted.
- **Copying an asset leaves the label behind**, because imported asset tags live there and one tag names one item. The cost: a descriptive label has to be retyped (What's next, item 6).
- **Web app, not native iOS.** One deployable for the phone and the office, openable from a link. Native becomes the better client if offline capture or LiDAR scanning becomes a requirement.
- **Hono, Postgres with Drizzle, PGlite for tests.** Tests run the whole API in memory against real Postgres semantics, with no Docker; the same tests run on Postgres 16.

## Testing

```bash
npm test                                   # 75 API tests on in-memory PGlite, ~4 s
TEST_DATABASE_URL=postgres://campus:campus@localhost:5432/campus_walk npm test   # same tests on Postgres
npm run typecheck
```

Covered: location rules (consistent and inconsistent triples, server-side resolution), moves (room→room, room→building, cross-building) with events, copies (fields duplicated, photos left behind), stale-version 409 with no write, the quantity rule for individually tracked types, summary math (quantity sums, poor threshold, unwalked rooms, building filter), walked/unwalked, the photo flow (asset photos, room photos, the photo screen, content sniffing and the size cap, separate key prefixes for room and asset photos) with a fake suggester and in-memory storage, suggestion normalisation of malformed model output, CSV parser round-trips, room import (creates, updates, in-file duplicates, all-or-nothing), the category table and recategorising a type, unrated inventory records, the district inventory import (both sample campuses, attribution, re-runs, a differently shaped district, repeated ids refused), and the "Did you mean" name matching for new types.

The web app was exercised end to end against the running stack in headless Chrome: name → projects → campus → building (floor filter) → room → room photo → photo screen → add asset → copy to another room → asset → edit → induced 409 → load theirs → save → move → building systems → delete (from the asset and from a room row) → delete photo → mark walked → clear → summary, and the asset photo path with a real 2000px image through the client resize, presigned PUT and attach-on-create. Later features got their own runs: the imported district (unrated assets, provenance, the summary's not-rated count), categories from the table, recategorising a type, the "Did you mean" prompt, marking a room walked with unrated assets, and room and asset photos landing under their own prefixes. No console errors.

## AI usage

Two different things:

- **In the product**, Claude on Bedrock is meant to look at the photo and suggest the asset type, condition and a note. Scoped deliberately small: one image, the catalogue's type names, structured output, and every field editable. The suggestion is kept on the photo so the office can see what the model said versus what the walker chose. This stretch item is only partly done: the client, the photo endpoint, the stored suggestion and the form pre-fill are written, and the API side is tested with a fake suggester and with malformed model output, but without Bedrock access it has never made a real call and the pre-fill has not been seen in the browser.
- **In building it**, I used Claude Code as a pair: scaffolding, the Drizzle schema from my data model, route and test boilerplate, the CSV parser, the headless UI walk-through, and the diagrams. The data model, location rules, concurrency approach, what to cut and the tooling choices above are mine; everything generated was reviewed and most of it reshaped. The git history reflects the actual sequence of work.
- **One concrete correction.** The generated seed wrote asset-event snapshots in database shape (type as a foreign key), so the history screen rendered "Recorded 2 ×, condition 4" with no type name. The headless walk-through caught it; the snapshot now matches the API shape and the screen has a fallback for old events. Another, in the product itself: a model answer naming a type outside the catalogue is dropped to null rather than shown, because a confident wrong label costs the walker more than an empty field.

## What's next

In rough order:

1. **Deploy it.** Run the stack in `infra/` against a real account and fix what the first deploy turns up. Then harden: a custom domain with an ACM certificate, WAF in front of CloudFront, RDS multi-AZ with deletion protection and longer backups, VPC endpoints instead of public task IPs, and a pipeline that runs the tests before `cdk deploy`.
2. **Govern the asset-type catalogue.** An `asset_type_alias` table mapping alternative names to a canonical type, so "RTU" or "Packaged HVAC Unit" resolves to Rooftop HVAC Unit in search and in imports (the importer's category synonyms are the same idea, still in code). Types created in the field start as `proposed`: usable at once, so the walk never stops, flagged in the office summary, and either approved or merged by the office. A merge re-points the assets through the normal versioned update, so each one gets a history entry, and keeps the old name as an alias.
3. **Authentication, reconsidered.** The pick-a-name identity is a placeholder. The real version is a hosted login (Cognito or Entra ID, since districts and firms live in Microsoft 365) issuing a JWT the API verifies, with `app_user` keyed to the identity provider's subject so the existing `changed_by` and `walked_by` columns keep working unchanged. Roles would start small: walker (write assets and walk status), office (read summary, import rooms, export), admin (manage campuses and users). The `x-user-id` header is isolated in one middleware and one client function, so swapping it for a bearer token touches two files plus tests.
4. **Offline-lite**: service worker caching the app shell and campus tree, writes queued in IndexedDB and replayed on reconnect (version checks still apply).
5. OpenAPI document from the zod schemas (`@hono/zod-openapi`).
6. **Separate the asset tag from the label.** Imported asset tags live in `label`, which walkers also use as a free description, so copying an asset now drops the label. A unique `asset_tag` column (never copied) next to a descriptive label (copied) removes the trade-off.
7. **Training data export.** Room and asset photos are already under separate prefixes; the next step is a manifest per prefix joining each photo to its walker-confirmed type and condition, and a scheduled sweep of uploads that were never recorded.
8. `PATCH /photos/:id` to re-attach a photo; recently used rooms first in the move picker; a log of catalogue changes (recategorising a type is currently unversioned).

Cut for this submission and why: floor-plan parsing to auto-generate rooms (replaced by seed + CSV import), multi-photo detection and duplicate matching (replaced by single-photo suggestion + quantity), on-device detection, 3D room capture, full offline-first sync with CRDTs. Auth and roles are not cut, just deferred (item 3 above).
