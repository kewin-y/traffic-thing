# Traffic Thing

A traffic planning app for editing road scenarios and comparing SUMO simulations.

## Repository layout

- [`app/`](app/README.md) — Next.js frontend, Convex backend, and authentication.
  Its README covers app setup, structure, and commands.
- [`worker/`](worker/README.md) — uv-managed Python/SUMO HTTP service.
  Its README covers network assets, local execution, Docker, and the simulation API.
- [`compose.yaml`](compose.yaml) — local container configuration for the worker.
- `networks/` — local SUMO network and demand files; ignored by Git and mounted
  read-only into the worker.
- [`flake.nix`](flake.nix) and [`.envrc`](.envrc) — optional Nix/direnv development environment.

## Development environment

With Nix and direnv installed, run from the repository root:

```bash
direnv allow
```

Alternatively, enter the shell directly with `nix develop`. The devshell provides
Node.js, pnpm, uv, Python tooling, SUMO, and native libraries needed by the Python
SUMO wheels. Python itself is provisioned by uv rather than Nix.

Nix is not required for the containerized worker; its Docker image includes the
runtime and native dependencies.

## Getting started

1. Follow the [app setup](app/README.md#usage) to run Next.js and Convex.
2. Follow the [worker setup](worker/README.md#local-development) to create demo
   network assets and run a local simulation service.
3. For a containerized service, follow the [worker Docker instructions](worker/README.md#docker).
   Run Compose commands from the repository root.

Component-specific configuration, commands, and API details live in the respective
README rather than being duplicated here.
