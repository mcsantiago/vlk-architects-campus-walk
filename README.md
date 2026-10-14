# Campus Walk

A phone-first app for the campus walk an architect does at the start of a facilities assessment: open the room you are standing in, record what is in it (photo → AI suggestion → confirm), mark the room walked, and let the office watch the campus summary fill in.

Take-home for the VLK Senior Full Stack Engineer role. Status as of 2026-10-12: API and web app complete and tested locally; AWS deployment is next (see [What's next](#whats-next)).

- [Run it locally](#run-it-locally)
- [Walk through it](#walk-through-it)
- [How it's built](#how-its-built)
- [Design decisions](#design-decisions)
- [Technology considerations](#technology-considerations)
- [Testing](#testing)
- [AI usage](#ai-usage)
- [What's next](#whats-next)

Deeper docs: [`docs/architecture.md`](docs/architecture.md) (Mermaid system diagrams, data model, request lifecycles), [`docs/api.md`](docs/api.md) (every endpoint with request, response and error shapes), [`Project Scope.md`](Project%20Scope.md) (the plan this was built against).

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

`db:import-sample` loads a district's existing inventory (`data/sample/*.csv`, or a directory you pass) as the starting point for a walk, which is how a real engagement starts: the walk verifies what is on the books rather than building the list from nothing. Rated rows keep their rating, the person who gave it and the date; rows in rooms nobody has reached yet come in as **not rated**, and the office summary counts them. Room types are stored as the district wrote them, categories are normalised onto ours (anything unrecognised becomes equipment, with a note), only the columns needed to place a row are required and extra columns are ignored, so another district's files need no code change. Everything is validated first and written in one transaction; a campus already in the database is skipped.

No Docker? Set `DATABASE_URL=pglite://.data/pg` in `.env` for embedded Postgres; photos then live in memory until restart.

The AI suggestion is off unless `BEDROCK_MODEL` is set (see `.env.example`). It uses the default AWS credential chain and a Bedrock-enabled region. Everything else works without it; the add-asset form just opens empty.

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
6. **Add asset.** Photo first: it is resized on the phone, uploaded straight to object storage, and sent to Claude, which proposes the type, condition and a one-line note. Fix anything wrong, set the quantity (furniture is counted; technology, equipment and systems are one record each), pick a condition from five big buttons, save. **What is it?** searches the shared catalogue as you type; if the thing in front of you is not in it, add it right there (name, category, counted or one-per-unit) and it is available to every walker, and to the photo suggestion, from then on. Category belongs to the type, so **Change…** under a chosen type recategorises every asset of that type at once (projectors from equipment to technology, say).
7. **Asset.** The photo large (tap for the photo screen), the facts (including make, model, serial and install year when the district's inventory had them), and Edit / Move / Copy / Delete plus the full history. An imported asset nobody has rated yet says so; editing it asks for a condition. **Edit** is its own screen; if someone else saved the same asset first you see who, what they changed, and can load their version before re-applying yours.
8. **Photo.** One photo full-width with what it is of and the model's note if there was one.
9. **Mark room walked** sends you back to the building with the next room highlighted.

**Office (laptop):** the campus summary at `/c/<campus>/summary`, a two-column dashboard on a desk and a single column on a phone: rooms walked and headline numbers (including how many imported assets are still unrated), then rooms not yet walked grouped by building and floor (the office's first question, so it is first), assets in poor condition linking to the record, counts by type (sum of quantity; the top eight, with a toggle for the rest), a building filter, CSV export of assets and rooms, and CSV import of rooms (the rooms export is the template).

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
| AI | Claude on Amazon Bedrock | Structured output parsed into a zod schema; refusal, malformed output or an error degrade to "no suggestion". |
| Web | React + Vite | ~127 KB gzipped. Installable manifest; a service worker is the next step for offline. |

## Design decisions

**Where an asset lives.** `building_id` is required; `floor_id` and `room_id` are optional and narrow it. A rooftop unit is building-level, a corridor fire panel is floor-level, 24 desks are in a room. Composite foreign keys `(room_id, floor_id) → room` and `(floor_id, building_id) → floor` plus a check constraint make an inconsistent triple impossible to store, so the API resolves whichever level the client sends and the database catches anything that disagrees. Fake "Roof" rooms were rejected because they would show up in "rooms not walked".

**Counted vs tracked.** Furniture is a count (`quantity`), equipment and systems are one record each (`tracked_individually` on the type, enforced by the API). This matches how assessments are written up, keeps the walk fast, and avoids trying to match the same chair across photos.

**Identity without auth (deliberately temporary).** The walker picks a name once; the API finds-or-creates the user and the client sends the id as `x-user-id` on writes. It becomes `changed_by` on every asset event and the room's walker. This gives the audit trail a person without a login flow, which is what a take-home needs, but it is not an authentication layer: anyone who can reach the API can write as anyone. It is the first thing to replace before real use; see [What's next](#whats-next). The access code in the deployment stack is a demo gate on the URL, not authentication either.

**Two walkers at once.** Every asset carries a `version`. Writes send the version they read; a stale one gets a 409 with the current record and nothing is written. The UI shows who changed it and what, and offers their version to start from. Marking a room walked is idempotent and last-writer-wins on purpose.

**History.** Every create, update, move and delete writes an `asset_event` with before/after snapshots and who did it. Deletes are soft so the history keeps pointing at something.

**Photo flow.** `POST /uploads` mints a key and a presigned PUT; the phone resizes to ≤1600px JPEG and PUTs directly; `POST /photos` records the object and runs the suggestion. Photos can be taken before the asset exists and attached on create, which is the natural order in the field. The suggestion is stored on the photo for audit even after the walker overrides it.

Before recording a photo the API checks what the bytes are, not what the PUT claimed: the first bytes must carry a JPEG, PNG or WebP signature that agrees with the declared type, and it reads at most 10 MB (a ranged GET, so an oversized object is never pulled into memory). It never decodes the image; the browser does when resizing and the model does when looking, so decompression risk stays off the server. The photo row is written before the model is asked, and the model call gets 12 seconds per attempt with one retry (about 25 seconds worst case, against the SDK's ten-minute default), so a slow or failing model leaves the form empty but never the photo unsaved.

Deliberately deferred: an object that was PUT but never recorded, or a draft photo taken on the add-asset screen and then abandoned, stays behind (an object, and for drafts a row). Keys are unguessable UUIDs minted by the API and the objects are a few hundred KB, so the cost is storage, not exposure. Removing a draft photo on the add-asset screen does delete it. The production fix is a scheduled sweep: objects older than a day with no photo row, and unattached photo rows older than a day. Photos also carry no uploader; that belongs with the authentication work in [What's next](#whats-next).

**CSV import of rooms** is the realistic stand-in for "upload a floor plan": buildings and floors are created as needed, existing rooms keep their assets and walk status, the whole file is validated first and written in one transaction, and errors come back with line numbers.

**Seed instead of create.** Architects do not create rooms in the field; the floor plan is known before the walk. So the field UI assigns assets to existing rooms, and rooms come from the seed, the CSV import, or a district's inventory (`db:import-sample`).

**Closed and open lists.** Asset category is the one closed list (four values: it drives grouping and colour, and the type picker's chips), and a type's category can be changed in place because every asset follows its type. Room type is free text: it is only ever displayed, so a district's "Band Hall" or "Training Room" needs no code change. Condition is 1–5 or null; null means "on the inventory, not yet walked", which is a real state once a walk starts from existing records rather than an empty room.

## Technology considerations

**Hono vs Express.** Express would have been fine. Hono was chosen for Web-standard request/response objects (the whole API is tested with `app.request()` and no listening socket), first-class TypeScript, and portability to Lambda or edge runtimes if the deployment target changed. The validation story is the same either way: zod at the boundary.

**Postgres vs CouchDB + PouchDB.** Seriously considered on day four for offline capture and two-walker sync, which is what Pouch replication is built for. Set aside for this submission: the office roll-ups are relational, location integrity lives in database constraints, the brief asks for an API I wrote (replication would replace most of it), sync conflicts would still need a resolution UI, and neither AWS nor Azure offers managed CouchDB. The version-field 409 plus a planned IndexedDB outbox covers the same two stretch items at a fraction of the cost. If offline-first became the primary requirement, Pouch/Couch (or ElectricSQL over Postgres) would be the first thing to revisit.

**PGlite.** Embedded Postgres (WASM) lets the whole test suite run in memory with the real dialect, constraints and migrations, with no Docker in CI. The same tests also run on Postgres 16 to make sure nothing is PGlite-specific.

**Bedrock with structured output.** The suggestion uses the Anthropic SDK's Bedrock client and asks for a zod-typed result, so there is no prompt-and-pray JSON parsing. Low effort, one image, a short list of known types; a wrong or missing answer costs the walker nothing because the form is editable.

**Web app vs native iOS.** The field half of this is a natural iOS app, and that would be the right second client once offline capture or LiDAR room scanning became a requirement: a SwiftData outbox is more trustworthy than a service worker for a day in a building with no signal, Safari will not upload a photo queue in the background, and ARKit is the path to the 3D capture that was cut. For this submission the web app wins: one deployable covers the walker's phone and the office laptop with the same shared types, the browser already has the rear camera (`capture="environment"`), the file picker and on-device resize, it installs to the home screen from the manifest, and a reviewer can open it from a link instead of TestFlight. The API is already shaped for a native client (JSON everywhere, presigned uploads, version checks), so adding one would not change the backend.

**RustFS locally.** MinIO's public images were withdrawn, so the compose stack uses RustFS, which speaks the same S3 API including presigned URLs and bucket CORS.

## Testing

```bash
npm test                                   # 44 API tests on in-memory PGlite, ~3 s
TEST_DATABASE_URL=postgres://campus:campus@localhost:5432/campus_walk npm test   # same tests on Postgres
npm run typecheck
```

Covered: location rules (consistent and inconsistent triples, server-side resolution), moves (room→room, room→building, cross-building) with events, copies (fields duplicated, photos left behind), stale-version 409 with no write, the quantity rule for individually tracked types, summary math (quantity sums, poor threshold, unwalked rooms, building filter), walked/unwalked, the photo flow (asset photos, room photos, the photo screen) with a fake suggester and in-memory storage, suggestion normalisation of malformed model output, CSV parser round-trips, and room import (creates, updates, in-file duplicates, all-or-nothing).

The web app was exercised end to end against the running stack in headless Chrome: name → projects → campus → building (floor filter) → room → room photo → photo screen → add asset → copy to another room → asset → edit → induced 409 → load theirs → save → move → building systems → delete (from the asset and from a room row) → delete photo → mark walked → clear → summary, and the asset photo path with a real 2000px image through the client resize, presigned PUT and attach-on-create. No console errors.

## AI usage

Two different things:

- **In the product**, Claude on Bedrock looks at the photo and suggests the asset type, condition and a note. Scoped deliberately small: one image, a fixed list of types, structured output, and every field editable. The suggestion is kept on the photo so the office can see what the model said versus what the walker chose.
- **In building it**, I used Claude Code as a pair: scaffolding, the Drizzle schema from my data model, route and test boilerplate, the CSV parser, the headless UI walk-through, and the diagrams. The data model, location rules, concurrency approach, what to cut and the tooling choices above are mine; everything generated was reviewed and most of it reshaped. The git history reflects the actual sequence of work.
- **One concrete correction.** The generated seed wrote asset-event snapshots in database shape (type as a foreign key), so the history screen rendered "Recorded 2 ×, condition 4" with no type name. The headless walk-through caught it; the snapshot now matches the API shape and the screen has a fallback for old events. Another, in the product itself: a model answer naming a type outside the catalogue is dropped to null rather than shown, because a confident wrong label costs the walker more than an empty field.

## What's next

In rough order:

1. **Deploy it.** Run the stack in `infra/` against a real account and fix what the first deploy turns up. Then harden: a custom domain with an ACM certificate, WAF in front of CloudFront, RDS multi-AZ with deletion protection and longer backups, VPC endpoints instead of public task IPs, and a pipeline that runs the tests before `cdk deploy`.
2. **Authentication, reconsidered.** The pick-a-name identity is a placeholder. The real version is a hosted login (Cognito or Entra ID, since districts and firms live in Microsoft 365) issuing a JWT the API verifies, with `app_user` keyed to the identity provider's subject so the existing `changed_by` and `walked_by` columns keep working unchanged. Roles would start small: walker (write assets and walk status), office (read summary, import rooms, export), admin (manage campuses and users). The `x-user-id` header is isolated in one middleware and one client function, so swapping it for a bearer token touches two files plus tests.
3. **Offline-lite**: service worker caching the app shell and campus tree, writes queued in IndexedDB and replayed on reconnect (version checks still apply).
4. OpenAPI document from the zod schemas (`@hono/zod-openapi`).
5. `PATCH /photos/:id` to re-attach a photo; multiple campuses; recently used rooms first in the move picker.

Cut for this submission and why: floor-plan parsing to auto-generate rooms (replaced by seed + CSV import), multi-photo detection and duplicate matching (replaced by single-photo suggestion + quantity), on-device detection, 3D room capture, full offline-first sync with CRDTs. Auth and roles are not cut, just deferred (item 2 above).
