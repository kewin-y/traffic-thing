# FlowState

Edit road layouts, save map projects, and run SUMO traffic simulations.

- [App](app/README.md): Next.js frontend and Convex backend.
- [Worker](worker/README.md): Python/SUMO service, network imports, and simulation setup.
- `scripts/`: network import, publishing, and traffic-control extraction.
- `networks/`: generated assets, ignored by Git.

## Start

Requires Node.js 22+, pnpm, and Docker. Optional: `nix develop` or `direnv allow`
provides development tools.

1. Follow the [app setup](app/README.md#setup).
2. Follow the [worker setup](worker/README.md#setup), then [import and publish a network](worker/README.md#toronto-network).
3. Open [localhost:3000](http://localhost:3000), sign in, and create a project.

Publish the network **before creating projects**: each project pins the version
available at creation. Simulations use GCN car demand when available, plus synthetic active travel.
Imported-road closures and lane-count changes affect runs; recorded runs play
back on the map from history.
