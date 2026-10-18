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

## Guideline check

The editor's "Check" button marks components that break Toronto planning rules.
Each rule cites the source of the number it tests:

- [Road Engineering Design Guidelines: Lane Widths (2018)](https://www.toronto.ca/wp-content/uploads/2018/05/986b-Lane-Widths-Guideline-Version-2.0.1-May-2018.pdf) — car, streetcar, and two-lane road widths
- [T-310.010-10, pedestrian clearway widths](https://www.toronto.ca/wp-content/uploads/2018/10/983b-ecs-specs-roadwd-T-310.010-10_Rev1_Sep2018.pdf) — minimum sidewalk width, kept clear of the roadway
- [Highway Traffic Act, R.R.O. 1990, Reg. 623: Stop Signs at Intersections](https://www.ontario.ca/laws/regulation/900623) — stop and yield signs at unsignalized intersections only
- [Spacing of Traffic Signals](https://www.toronto.ca/wp-content/uploads/2024/09/9769-TSClosely-Spaced-Signals-PolicyFinal.pdf) — minimum spacing between signalized intersections
- [Vision Zero: speed limit reductions](https://www.toronto.ca/services-payments/streets-parking-transportation/road-safety/vision-zero/safety-initiatives/initiatives/speed-limit-reductions/) — posted speed caps
- [Minimum separation distances (CaféTO)](https://www.toronto.ca/wp-content/uploads/2026/07/8efa-Minimum-Separation-Distance.pdf) — clearances around furniture, lights, and crossings
- [Toronto Municipal Code Chapter 743, Streets and Sidewalks, Use of](https://www.toronto.ca/legdocs/municode/1184_743.pdf) — objects in travel lanes need a permit
- [Zoning By-law 569-2013](https://www.toronto.ca/city-government/planning-development/zoning-by-law-preliminary-zoning-reviews/zoning-by-law-569-2013-2/) — buildings stay behind the street line

Zone-specific zoning limits (height, density) are not modelled.

## Data Sources

- https://open.toronto.ca/dataset/traffic-volumes-midblock-vehicle-speed-volume-and-classification-counts/
- https://open.toronto.ca/dataset/permanent-bicycle-counters/
- https://open.toronto.ca/dataset/permanent-bicycle-counters/
- https://open.toronto.ca/dataset/cycling-network/
