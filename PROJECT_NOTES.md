# Project Notes

## Who is the user?
City planners, urban designers, and community groups shaping Toronto streets, starting downtown.

## What problems are they facing?
- Car-first streets cut neighbourhoods apart. People drive past each other and rarely meet.
- Streets that feel unsafe, have no shade, or are hard to get around with a disability keep people from walking.
- Testing a redesign in the real world (pilots, construction, consultation) is slow and expensive, and it is hard to undo. Planners often only see the effects after money is spent.

## How can we solve it with the data we have?
A 3D editor for a real Toronto street network, linked to a traffic simulation.
- **Design for interaction.** Planners place features that shape how people move and gather:
  - circular benches and plazas that face people toward each other
  - curbs or level changes between bike lanes and traffic
  - trees and greenery for shade and more pleasant walks
  - crosswalks and accessible, barrier-free layouts that work for everyone
- **Simulate.** Each edit (lane count, speed limit, crosswalk, signal) runs through SUMO on the real road network. Results are compared with a baseline: throughput, completed trips, and delay.
- **Visualize.** Pedestrians, cyclists, scooters, and transit move through the 3D scene, so the effect of a change is visible, not just a table of numbers.
- **Forecast car demand with ML.** The committed GCN predicts per-edge car volumes for baseline and edited road features. Walking, cycling and scooter demand currently uses fixed ratios of car trips; safety and collision predictions are future work.

## How does this benefit the user?
- **Community:** more walkable streets give people more chances to meet, which supports local business, safety, and belonging.
- **Inclusive design:** accessibility is checked before anything is built.
- **Cost:** ideas are tested virtually first, so only designs that work move on to costly pilots.
- **Evidence:** planners get clear before/after visuals and numbers to show council and residents.

## Data sources
**In use**
- OpenStreetMap: roads, buildings, traffic controls (via the Overpass API): https://www.openstreetmap.org/copyright, https://overpass-api.de/
- MapTiler: Toronto basemap and 3D buildings: https://www.maptiler.com/
- Eclipse SUMO: traffic simulation: https://eclipse.dev/sumo/

**Potential future data and calibration sources**
- Toronto traffic volumes, all modes: https://open.toronto.ca/dataset/traffic-volumes-at-intersections-for-all-modes/
- Toronto cycling network: https://open.toronto.ca/dataset/cycling-network/
- Toronto street trees: https://open.toronto.ca/dataset/street-tree-data/
- Toronto Police Service collision data: https://data.torontopolice.on.ca/
