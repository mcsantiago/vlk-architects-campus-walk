# Campus Walk — Systems Diagram

Status as of 2026-10-12. **Solid** = built and tested. **Dashed** = planned (AWS deploy).
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
  bedrock["Claude on Amazon Bedrock\n(Mantle client, structured output)"]

  walker --> web
  office --> web
  web -->|"JSON + x-user-id"| routes
  web -->|"presigned PUT / GET"| s3

  routes -->|"Drizzle"| pg
  routes -->|"presign · get bytes"| s3
  routes -->|"photo → type + condition"| bedrock

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
    assets["assets.ts\ncreate · update · move · delete\nversion check → 409 · asset_event"]
    location["location.ts\nroom → floor → building resolution"]
    photos["photos.ts\nupload key · record + suggest · attach"]
    csv["csv.ts\nassets.csv · rooms.csv · rooms import"]
  end

  subgraph infra["Adapters"]
    storage["storage.ts\nPhotoStorage: S3PhotoStorage | MemoryPhotoStorage"]
    suggest["suggest.ts\nSuggester: BedrockSuggester | noSuggester\nnormalizeSuggestion()"]
    csvlib["csv.ts (root)\nRFC 4180 parse / serialize"]
    db["db/client.ts\nDATABASE_URL → node-postgres | PGlite\ndb/schema.ts · drizzle/ migrations · db/seed.ts"]
  end

  server --> app --> routes
  routes --> errors
  routes --> users & campus & assets & photos & csv
  assets --> location
  assets --> photos
  photos --> storage & suggest
  csv --> csvlib
  users & campus & assets & photos & csv --> db
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

```mermaid
sequenceDiagram
  autonumber
  participant P as Phone (web app)
  participant API as API
  participant S3 as Object storage
  participant B as Claude on Bedrock
  participant D as Postgres

  P->>API: POST /uploads {contentType}
  API->>S3: presign PUT photos/<uuid>.jpg
  API-->>P: {key, url, expiresInSeconds}
  P->>S3: PUT image bytes (direct, CORS)
  P->>API: POST /photos {s3Key}
  API->>API: key matches PHOTO_KEY? not already recorded?
  API->>S3: GET object bytes
  API->>D: SELECT asset_type (names for the prompt)
  API->>B: messages.parse(image + type list, zod output format, effort low)
  alt parsed and useful
    B-->>API: {asset_type, condition, confidence, note}
    API->>API: normalizeSuggestion → resolve type name → id
  else refusal / malformed / error / > 4.5 MB
    API->>API: suggestion = null (form opens empty)
  end
  API->>D: INSERT photo {s3Key, assetId: null, ai_suggestion}
  API-->>P: photo {id, url (presigned GET), suggestion}
  P->>P: pre-fill type + condition + note; walker confirms or edits
  P->>API: POST /assets {roomId, assetTypeId, condition, notes, photoIds:[id]}
  API->>D: INSERT asset · UPDATE photo SET asset_id (must be unattached) · INSERT asset_event
  API-->>P: AssetView
```

## 5. Data model

```mermaid
erDiagram
  CAMPUS ||--o{ BUILDING : has
  BUILDING ||--o{ FLOOR : has
  FLOOR ||--o{ ROOM : has
  BUILDING ||--o{ ASSET : "always located in"
  FLOOR |o--o{ ASSET : "optionally on"
  ROOM |o--o{ ASSET : "optionally in"
  ASSET_TYPE ||--o{ ASSET : classifies
  ASSET |o--o{ PHOTO : "photo of asset"
  ROOM |o--o{ PHOTO : "photo of room"
  ASSET ||--o{ ASSET_EVENT : history
  APP_USER |o--o{ ROOM : walked
  APP_USER ||--o{ ASSET_EVENT : acted

  APP_USER {
    uuid id PK
    text name "unique lower(name)"
  }
  CAMPUS {
    uuid id PK
    text name
    text district
    text address "nullable, with contact_name/phone/email"
  }
  BUILDING {
    uuid id PK
    uuid campus_id FK
    text code "unique per campus"
    text name
    int year_built
  }
  FLOOR {
    uuid id PK
    uuid building_id FK
    int level "unique per building"
    text name
  }
  ROOM {
    uuid id PK
    uuid floor_id FK
    text number "unique per floor"
    text name
    text room_type
    timestamptz walked_at
    uuid walked_by_id FK
  }
  ASSET_TYPE {
    uuid id PK
    text name "unique"
    text category "furniture | equipment | system"
    bool tracked_individually
  }
  ASSET {
    uuid id PK
    uuid building_id FK
    uuid floor_id FK "composite FK (floor, building)"
    uuid room_id FK "composite FK (room, floor)"
    uuid asset_type_id FK
    text label
    int quantity "1 if tracked individually"
    int condition "1..5"
    text notes
    int version "optimistic concurrency"
    timestamptz deleted_at "soft delete"
  }
  PHOTO {
    uuid id PK
    uuid asset_id FK "null until attached, or a room photo"
    uuid room_id FK "set for photos of the room itself; never both"
    text s3_key "unique"
    jsonb ai_suggestion
  }
  ASSET_EVENT {
    uuid id PK
    uuid asset_id FK
    text kind "created | updated | moved | deleted"
    jsonb before
    jsonb after
    uuid changed_by FK
    timestamptz changed_at
  }
```

Location integrity lives in the database: `asset(floor_id, building_id)` references `floor(id, building_id)` and `asset(room_id, floor_id)` references `room(id, floor_id)`, so a room on the wrong floor or a floor in the wrong building cannot be stored. `location.ts` fills in the levels above the one the client sent and turns the same violations into readable 400s.

## 6. Environments

```mermaid
flowchart LR
  subgraph local["Local (docker compose up)"]
    lweb["web :5173\nvite dev"]
    lapi["api :3000\ntsx watch"]
    lpg[("postgres:16-alpine :5432")]
    lrust[("RustFS :9000\nbucket campus-walk-photos\nCORS from docker/s3-cors.json")]
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

  subgraph aws["AWS via CDK (planned)"]
    cf["CloudFront + S3\n(web)"]
    alb["ALB → ECS Fargate\n(api, task role)"]
    rds[("RDS Postgres t4g.micro\nDATABASE_SSL=require")]
    ps3[("S3 photos")]
    br["Bedrock\nBEDROCK_MODEL=anthropic.claude-opus-5-5"]
    sm["Secrets Manager\n(DB creds)"]
    cf -.-> alb
    alb -.-> rds & ps3 & br & sm
  end

  classDef planned stroke-dasharray: 5 5
  class aws,cf,alb,rds,ps3,br,sm planned
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
    user["user.ts\nchosen user + recent types in localStorage"]
  end

  subgraph pages["Pages"]
    who["WhoPage (stand-in login)"]
    projects["ProjectsPage\ncampuses"]
    campus["CampusPage\ncontact · progress · buildings"]
    building["BuildingPage\ncontact · floor dropdown · rooms"]
    systems["SystemsPage\nbuilding/floor-level assets"]
    room["RoomPage\nwalked · room photos · assets (edit/copy/delete)"]
    anew["AssetNewPage\nphoto → suggestion → fields"]
    asset["AssetPage\nphoto · facts · move · copy · delete · history"]
    aedit["AssetEditPage\nfields · photos · 409 handling"]
    photo["PhotoPage\nfull size · subject · delete"]
    summary["SummaryPage\noffice roll-up · CSV"]
  end

  subgraph comps["Components"]
    fields["AssetFields\nTypePicker · Stepper · ConditionPicker"]
    loc["LocationPicker · CopySheet"]
    psec["PhotoSection"]
    info["SiteInfoCard"]
  end

  main --> app --> pages
  pages --> queries --> client
  anew & aedit --> fields & psec
  room --> psec
  asset & room --> loc
  campus & building --> info
  psec --> photos --> client
  client --> user
```

Field flow: pick a name once → projects → campus → building (floor dropdown) → room → **Add asset** (photo first; the suggestion pre-fills type, condition and note; the walker confirms) → **Mark room walked** → back to the building with the next unwalked room outlined. A stale save (409) shows "Updated by X while you were editing" with their changes and a button to load their version.

## 8. Endpoint map

| Area | Endpoints | Service |
|---|---|---|
| Identity | `GET/POST /users` | users.ts |
| Browse | `GET /campuses`, `GET /campuses/:id/tree`, `GET /rooms/:id`, `GET /buildings/:id/systems`, `GET /asset-types` | campus.ts |
| Walk | `POST/DELETE /rooms/:id/walked` | campus.ts |
| Assets | `GET /assets/:id`, `POST /assets`, `PATCH /assets/:id`, `POST /assets/:id/move`, `POST /assets/:id/copy`, `DELETE /assets/:id` | assets.ts |
| Photos | `POST /uploads`, `POST /photos` (asset, room, or unattached), `GET /photos/:id`, `DELETE /photos/:id` | photos.ts |
| Office | `GET /campuses/:id/summary?buildingId=` | campus.ts |
| CSV | `GET /campuses/:id/assets.csv`, `GET /campuses/:id/rooms.csv`, `POST /campuses/:id/rooms/import` | csv.ts |

Writes require `x-user-id` (401 otherwise); reads do not. Errors are `{ error, details }`: zod issues on 400, the current record on 409.
