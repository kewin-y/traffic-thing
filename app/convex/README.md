# Convex backend

Feature-based layout: one folder per feature, cross-feature files at the root.

```
convex/
  schema.ts        # single schema (Convex requirement) — merges feature fragments
  auth.ts          # Convex Auth — must stay at api.auth.* (client convention)
  http.ts          # auth routes and POST /networks/upload-url
  networks/
    httpActions.ts # worker-authenticated recording upload URL
  numbers/
    schema.ts      # table fragment, merged into the root schema
    queries.ts     # listNumbers
    mutations.ts   # addNumber
    actions.ts     # runSample
```

Add feature functions under `convex/<feature>/` and merge their table definitions
in `schema.ts`. Run `pnpm dev` from `app/` to sync backend changes and regenerate
the API types.

Client usage example:

```ts
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const data = useQuery(api.numbers.queries.listNumbers, { count: 10 });
```
