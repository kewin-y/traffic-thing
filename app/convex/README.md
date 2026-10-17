# Convex backend

Feature-based layout: one folder per feature, cross-feature files at the root.

```
convex/
  schema.ts        # single schema (Convex requirement) — merges feature fragments
  auth.ts          # Convex Auth — must stay at api.auth.* (client convention)
  http.ts          # auth routes, recording upload URL, and network publishing
  networks/
    httpActions.ts # worker-authenticated recording upload URL and map publishing
    schema.ts      # versioned network records and map asset storage IDs
    mutations.ts   # internal, idempotent network registration
    queries.ts     # authenticated exact/latest network lookup and download URLs
    lib/assets.ts  # manifest, checksum, and GeoJSON validation
  numbers/
    schema.ts      # table fragment, merged into the root schema
    queries.ts     # listNumbers
    mutations.ts   # addNumber
    actions.ts     # runSample
```

Add feature functions under `convex/<feature>/` and merge their table definitions
in `schema.ts`. Run `pnpm dev` from `app/` to sync backend changes and regenerate
the API types.

See [publishing network map assets](../../worker/README.md#publish-map-assets-to-convex)
for importer-to-storage setup. `api.networks.queries.get` accepts a network `name`
and optional `version`, and returns map/manifest URLs for signed-in users.

Run `pnpm test` from `app/` for the in-memory Convex HTTP/storage tests.

Client usage example:

```ts
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const data = useQuery(api.numbers.queries.listNumbers, { count: 10 });
```
