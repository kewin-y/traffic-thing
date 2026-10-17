# Traffic app

Next.js frontend and Convex backend for the traffic planning application, built
from a starter with authentication, a landing page, and a dashboard with sample data.

See the [repository overview](../README.md) for the development environment and
the [worker README](../worker/README.md) for SUMO simulation setup and its HTTP API.

## Tech stack

- Next.js 16, React 19, TypeScript
- Convex + Convex Auth (email/password)
- Tailwind CSS 4, shadcn/ui (Base UI), Hugeicons
- TanStack Form + Zod
- `@wrksz/themes` (light/dark/system themes)

## Project structure

- `src/app/` — Next.js App Router routes, layouts, and global styles
- `src/features/` — feature-specific components, hooks, and utilities
- `src/components/`, `src/hooks/`, `src/lib/`, `src/contexts/` — shared frontend code
- `src/proxy.ts` — authentication and route protection
- `convex/` — backend functions, schema, and generated API
- `public/` — static assets

The `@/*` import alias points to `src/*`; `@/convex/*` points to this directory's `convex/` folder. App configuration and environment files live here in `app/`.

## Usage

Requires Node.js and pnpm. From the repository root:

```bash
cd app
pnpm install
pnpm dev
```

Follow the setup prompts to create a new Convex project and configure authentication. Open [localhost:3000](http://localhost:3000).

Other commands:

- `pnpm lint` checks code
- `pnpm build` builds the Next.js app

