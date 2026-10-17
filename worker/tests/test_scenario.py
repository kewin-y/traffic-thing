from traffic_worker.scenario import Lane, Scenario, _edge_classes, run_scenario

KERB_TO_CENTRE = [
    {"kind": "bike_lane", "width": 1.8},
    {"kind": "car_lane", "width": 3.3},
    {"kind": "streetcar_lane", "width": 3.3},
]


def scenario(**arms) -> Scenario:
    full = {"inbound": KERB_TO_CENTRE, "outbound": KERB_TO_CENTRE, "speed_kmh": 40}
    return Scenario.model_validate({
        "format": "traffic-thing-scenario-v1",
        "arm_length_m": 110,
        "control": "traffic_light",
        "arms": {arm: arms.get(arm, full) for arm in ("north", "east", "south", "west")},
        "demand": {
            "cars_per_hour_per_arm": 300,
            "bikes_per_hour_per_arm": 100,
            "streetcars_per_hour_per_direction": 10,
            "duration_seconds": 300,
        },
        "components": [{"kind": "tree"}],
    })


def test_cyclists_share_car_lanes_only_without_a_bike_lane():
    with_bike_lane = [Lane(kind="bike_lane", width=1.8), Lane(kind="car_lane", width=3.3)]
    assert _edge_classes(with_bike_lane) == ["bicycle", "passenger"]
    assert _edge_classes([Lane(kind="car_lane", width=3.3)]) == ["passenger bicycle"]


def test_closed_arm_drops_its_demand_and_the_rest_still_runs():
    closed = {"inbound": [], "outbound": [], "speed_kmh": 40}
    result = run_scenario(scenario(east=closed))
    assert "east" not in result["approaches"]
    assert any(line.startswith("car east ->") for line in result["skipped_flows"])
    assert result["modes"]["car"]["completed_trips"] > 0
    assert result["modes"]["streetcar"]["completed_trips"] > 0
