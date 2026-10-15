# Campus Walk — Systems Diagram

Status as of 2026-10-14. Everything shown is built and tested, with two exceptions: the AWS stack in `infra/` is synthesised and its API image verified locally but has not been deployed (descoped for the submission), and the Bedrock call behind the photo suggestion is written but has never run against a live model (no account access; it is tested with a fake suggester).
Mermaid blocks render in Obsidian's reading view.

## 1. System context

```mermaid
flowchart LR
  walker(["Walker on phone"])
  office(["Office on laptop"])

  subgraph client["apps/web — React 19 + Vite"]
    web["Field UI · Office summary\nTanStack Query · React Router"]
  end

  subgraph api["apps/api — Hono on Node"]
    routes["routes.ts"]
  end

  subgraph shared["packages/shared"]
    zod["zod request schemas · domain constants"]
  end

  pg[("Postgres 16\n(or PGlite embedded)")]
  s3[("Object storage\nRustFS local / S3 on AWS")]
  bedrock["Claude on Amazon Bedrock\n(Mantle client, structured output)\nwritten, not exercised live"]

  walker --> web
  office --> web
  web -->|"JSON + x-user-id"| routes
  web -->|"presigned PUT / GET"| s3

  routes -->|"Drizzle"| pg
  routes -->|"presign · get bytes"| s3
  routes -->|"photo → type + condition"| bedrock

  importer["db:import-sample\n(district inventory CSVs)"] -->|"one transaction"| pg

  zod --> web
  zod --> routes

```

## 2. API internals

```mermaid
flowchart TB
  subgraph entry["Entry"]
    server["server.ts\nenv → db, storage, suggester"]
    app["app.ts createApp()\ncors · logger · x-user-id → userId\nerrorHandler"]
  end

  subgraph http["HTTP layer"]
    routes["routes.ts"]
    errors["errors.ts\nHttpError · parseBody · idParam\nfromDbError (constraint → 400)"]
  end

  subgraph services["services/"]
    users["users.ts\nfind-or-create by name"]
    campus["campus.ts\ntree · room · walked · systems · summary"]
    types["types.ts\ncategories · type find-or-create · recategorise"]
    assets["assets.ts\ncreate · update · move · delete\nversion check → 409 · asset_event"]
    location["location.ts\nroom → floor → building resolution"]
    photos["photos.ts\nupload key (photos/assets/ or photos/rooms/) · record + suggest · attach"]
    csv["csv.ts\nassets.csv · rooms.csv · rooms import"]
  end

  subgraph infra["Adapters"]
    storage["storage.ts\nPhotoStorage: S3PhotoStorage | MemoryPhotoStorage"]
    suggest["suggest.ts\nSuggester: BedrockSuggester | noSuggester\nnormalizeSuggestion()"]
    csvlib["csv.ts (root)\nRFC 4180 parse / serialize"]
    db["db/client.ts\nDATABASE_URL → node-postgres | PGlite\ndb/schema.ts · drizzle/ migrations · db/seed.ts · db/import-sample.ts"]
  end

  server --> app --> routes
  routes --> errors
  routes --> users & campus & types & assets & photos & csv
  assets --> location
  assets --> photos
  photos --> storage & suggest
  csv --> csvlib
  users & campus & types & assets & photos & csv --> db
```

## 3. Request lifecycle (any write)

```mermaid
sequenceDiagram
  autonumber
  participant W as Web app
  participant A as app.ts middleware
  participant R as routes.ts
  participant S as service
  participant D as Postgres

  W->>A: PATCH /assets/:id  {version, ...}  x-user-id
  A->>A: validate header is a uuid → c.userId
  A->>R: next()
  R->>D: requireUser: SELECT app_user
  R->>R: parseBody(zod) → 400 on issues
  R->>S: updateAsset(db, id, input, actorId)
  S->>D: BEGIN
  S->>D: SELECT asset (live) → compare version
  alt stale version
    S-->>R: 409 conflict {current}
  else current
    S->>D: UPDATE ... WHERE id AND version = ? (guards the race)
    S->>D: INSERT asset_event {before, after, changed_by}
    S->>D: COMMIT
    S-->>R: AssetView
  end
  R-->>W: JSON
  Note over A,R: DB constraint violations are mapped by fromDbError → 400 with a readable message
```

## 4. Photo → AI suggestion → asset

The intended flow. The Bedrock call has not been exercised against a live model (no account access for this submission); everything else in the diagram runs, and the suggestion steps are tested with a fake suggester.

```mermaid
sequenceDiagram
  autonumber
  participant P as Phone (web app)
  participant API as API
  participant S3 as Object storage
  participant B as Claude on Bedrock
  participant D as Postgres

  P->>API: POST /uploads {contentType, subject: asset}
  API->>S3: presign PUT photos/assets/<uuid>.jpg
  API-->>P: {key, url, expiresInSeconds}
  P->>S3: PUT image bytes (direct, CORS)
  P->>API: POST /photos {s3Key}
  API->>API: key one we minted? subject matches roomId? not already recorded?
  API->>S3: GET object, first 10 MB + 1 (ranged)
  API->>API: too big? magic bytes say JPEG/PNG/WebP and agree with the declared type?
  API->>D: SELECT asset_type (names for the prompt)
  API->>D: INSERT photo {s3Key, assetId: null, ai_suggestion: null}
  API->>B: messages.parse(image + type list, zod output format, effort low, 12 s per attempt, 1 retry)
  alt parsed and useful
    B-->>API: {asset_type, condition, confidence, note}
    API->>API: normalizeSuggestion → resolve type name → id
    API->>D: UPDATE photo SET ai_suggestion
  else refusal / malformed / error / timeout / > 4.5 MB
    API->>API: suggestion = null (form opens empty, photo already saved)
  end
  API-->>P: photo {id, url (presigned GET), suggestion}
  P->>P: pre-fill type + condition + note, walker confirms or edits
  P->>API: POST /assets {roomId, assetTypeId, condition, notes, photoIds:[id]}
  API->>D: INSERT asset · UPDATE photo SET asset_id (must be unattached) · INSERT asset_event
  API-->>P: AssetView
```

## 5. Data model

Moved to [data-model.md](data-model.md): the table summary, the full ER diagram and the modelling decisions.

## 6. Environments

```mermaid
flowchart LR
  subgraph local["Local (docker compose up)"]
    lweb["web :5173\nvite dev · proxies /api → api"]
    lapi["api :3000\ntsx watch"]
    lpg[("postgres:16-alpine :5432")]
    lrust[("RustFS :9000\nbucket campus-walk-photos\nCORS from docker/s3-cors.json\npresigned for the requesting host")]
    lnone["no BEDROCK_MODEL\n→ empty suggestion"]
    lweb --> lapi
    lapi --> lpg & lrust
    lapi -.-> lnone
  end

  subgraph nodocker["Local, no Docker"]
    papi["api"]
    pglite[("PGlite\nDATABASE_URL=pglite://.data/pg")]
    mem[("MemoryPhotoStorage\n(lost on restart)")]
    papi --> pglite & mem
  end

  subgraph test["Tests (vitest)"]
    tapp["createApp({db, storage, suggester})"]
    tpg[("PGlite in-memory\nor TEST_DATABASE_URL → throwaway DB")]
    tmem[("MemoryPhotoStorage")]
    tfake["fake Suggester"]
    tapp --> tpg & tmem & tfake
  end

  subgraph aws["AWS via CDK (infra/)"]
    cf["CloudFront + S3 (web)\nFunction: access code, /api prefix, SPA shell"]
    alb["ALB (CloudFront header only)\n→ ECS Fargate api, task role"]
    rds[("RDS Postgres 16 t4g.micro\nisolated subnets, DATABASE_SSL=require")]
    ps3[("S3 photos\npresigned PUT/GET")]
    br["Bedrock\nBEDROCK_MODEL"]
    sm["Secrets Manager\nDB_USER / DB_PASSWORD"]
    cf --> alb
    alb --> rds & ps3 & br & sm
  end
```

## 7. Web app (apps/web)

```mermaid
flowchart TB
  subgraph entry["Entry"]
    main["main.tsx\nQueryClient · BrowserRouter"]
    app["App.tsx\nno user → WhoPage; else routes under /c/:campusId"]
  end

  subgraph data["Data layer (src/api)"]
    client["client.ts\nfetch wrapper · x-user-id · ApiError(status, details)"]
    queries["queries.ts\nTanStack Query hooks + invalidation"]
    photos["photos.ts\nshrinkImage (canvas, ≤1600px JPEG) → POST /uploads → PUT → POST /photos"]
  end
  user["user.ts\nchosen user + last name in localStorage"]

  subgraph pages["Pages"]
    who["WhoPage (stand-in login)"]
    projects["ProjectsPage\ncampuses"]
    campus["CampusPage\ncontact · progress · buildings"]
    building["BuildingPage\ncontact · floor dropdown · rooms"]
    systems["SystemsPage\nbuilding/floor-level assets"]
    room["RoomPage\nwalked · room photos · assets (edit/copy/delete)"]
    anew["AssetNewPage\nphoto → (suggestion) → fields"]
    asset["AssetPage\nphoto · facts · move · copy · delete · history"]
    aedit["AssetEditPage\nfields · photos · 409 handling · unsaved-changes guard"]
    photo["PhotoPage\nfull size · subject · delete"]
    summary["SummaryPage\noffice roll-up · CSV"]
  end

  subgraph comps["Components"]
    fields["AssetFields\nTypePicker (Did you mean · Change…) · Stepper · ConditionPicker"]
    loc["LocationPicker · CopySheet"]
    psec["PhotoSection · SuggestionNotice"]
    info["InfoCard (SiteInfoCard)"]
    rows["AssetRow · AssetList · CategoryBadge"]
    guard["Confirm (useConfirm) · UnsavedChanges"]
  end

  main --> app --> pages
  pages --> queries --> client
  anew & aedit --> fields & psec
  room --> psec
  asset & room --> loc
  campus & building --> info
  room & systems --> rows
  aedit --> guard
  psec --> photos --> client
  client --> user
```

Field flow: pick a name once → projects → campus → building (floor dropdown) → room → **Add asset** (photo first; with Bedrock configured the suggestion pre-fills type, condition and note, otherwise the form opens empty; the walker confirms) → **Mark room walked** → back to the building with the next unwalked room outlined. A stale save (409) shows "Updated by X while you were editing" with their changes and a button to load their version.

## 8. Endpoint map

| Area | Endpoints | Service |
|---|---|---|
| Identity | `GET/POST /users` | users.ts |
| Browse | `GET /campuses`, `GET /campuses/:id/tree`, `GET /rooms/:id`, `GET /buildings/:id/systems` | campus.ts |
| Catalogue | `GET /asset-categories`, `GET /asset-types`, `POST /asset-types` (find-or-create by name), `PATCH /asset-types/:id` (category, counting) | types.ts |
| Walk | `POST/DELETE /rooms/:id/walked` | campus.ts |
| Assets | `GET /assets/:id`, `POST /assets`, `PATCH /assets/:id`, `POST /assets/:id/move`, `POST /assets/:id/copy`, `DELETE /assets/:id` | assets.ts |
| Photos | `POST /uploads`, `POST /photos` (asset, room, or unattached), `GET /photos/:id`, `DELETE /photos/:id` | photos.ts |
| Office | `GET /campuses/:id/summary?buildingId=` | campus.ts |
| CSV | `GET /campuses/:id/assets.csv`, `GET /campuses/:id/rooms.csv`, `POST /campuses/:id/rooms/import` | csv.ts |

Writes require `x-user-id` (401 otherwise); reads do not. Errors are `{ error, details }`: zod issues on 400, the current record on 409.
