"""Unit tests for Predictor.compare (without loading a model checkpoint)."""
import pandas as pd

from traffic_worker.predictor import Predictor


def bare_predictor() -> Predictor:
    predictor = object.__new__(Predictor)  # skip torch model loading
    predictor.base_pred = pd.DataFrame(
        {
            "edge_id": [f"e{i}" for i in range(5)],
            "veh_per_day": [100.0] * 5,
            "veh_per_hour": [8.0] * 5,
        }
    )
    return predictor


def test_compare_returns_largest_changes_first_and_caps():
    predictor = bare_predictor()
    edited = predictor.base_pred.copy()
    edited["veh_per_day"] = [100.0, 200.0, 100.0, 150.0, 100.0]  # deltas: 0, 100, 0, 50, 0

    assert [c["edge_id"] for c in predictor.compare(edited, max_changes=1)] == ["e1"]
    assert [c["delta_per_day"] for c in predictor.compare(edited)] == [100.0, 50.0]


def test_compare_drops_trivial_changes():
    predictor = bare_predictor()
    edited = predictor.base_pred.copy()
    edited["veh_per_day"] = [100.4, 100.9, 102.0, 100.0, 100.0]

    changes = predictor.compare(edited, min_abs_change=1.0)
    assert [c["edge_id"] for c in changes] == ["e2"]
