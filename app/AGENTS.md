<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Project Structure

**Frontend:** Next.js routes and layouts live in `src/app/`, with the auth proxy at `src/proxy.ts`. Feature code lives in `src/features/<name>/{components,hooks,lib}/`; shared code lives in `src/components/` (UI), `src/hooks/` (React hooks), `src/lib/` (non-React code/types), and `src/contexts/` (React contexts). The `@/*` alias resolves to `src/*`; `@/convex/*` resolves to the root-level backend.

**Backend:** Feature code lives in `convex/<feature>/` (`schema.ts`, `queries.ts`, `mutations.ts`, `actions.ts`, `httpActions.ts`, `workflow.ts`, etc.). Put shared utilities in `convex/<feature>/lib/`.

**Convex constraints:** Keep `convex/schema.ts`, `convex/auth.ts`, and `convex/http.ts` at the root. The root schema merges feature `schema.ts` fragments exporting `defineTable` definitions. Keep auth functions in `convex/auth.ts` to expose them via `api.auth.*`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
