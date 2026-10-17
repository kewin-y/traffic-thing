# Convex backend

Feature-based layout: one folder per feature, cross-feature files at the root.

```
convex/
  schema.ts        # single schema (Convex requirement) — merges feature fragments
  auth.ts          # Convex Auth — must stay at api.auth.* (client convention)
  http.ts          # HttpRouter registration (auth routes)
  numbers/
    schema.ts      # table fragment, merged into the root schema
    queries.ts     # listNumbers
    mutations.ts   # addNumber
    actions.ts     # runSample
```

Adding a feature:

```bash
npx convex -h  # push, dev, and codegen live here; docs: https://docs.convex.dev/functions
```

Client usage example:

```ts
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const data = useQuery(api.numbers.queries.listNumbers, { count: 10 });
```
