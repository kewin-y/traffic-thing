"""
traffic_worker/predictor.py

Loads the trained TrafficGCN once at worker startup and predicts per-edge daily volume
for the baseline network and for a user-edited copy of it.

Model dir must contain:
    traffic_gcn_checkpoint.pt, traffic_gcn_meta.json, street_segments.csv
(all produced by the notebook; see the save cell that writes the meta JSON).
"""
import itertools
import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GCNConv

logger = logging.getLogger(__name__)
torch.set_num_threads(1)  # the worker already parallelises across requests


class TrafficGCN(nn.Module):  # must match the notebook exactly
    def __init__(self, in_channels, hidden_channels=64, dropout=0.2):
        super().__init__()
        self.conv1 = GCNConv(in_channels, hidden_channels)
        self.conv2 = GCNConv(hidden_channels, hidden_channels)
        self.head = nn.Linear(hidden_channels, 1)
        self.dropout = dropout

    def forward(self, x, edge_index):
        h = F.relu(self.conv1(x, edge_index))
        h = F.dropout(h, p=self.dropout, training=self.training)
        h = F.relu(self.conv2(h, edge_index))
        return self.head(h).squeeze(-1)


class Predictor:
    ENDPOINTS = ["start_lat", "start_lon", "end_lat", "end_lon"]

    def __init__(self, model_dir: Path, hour_share: float = 0.08):
        model_dir = Path(model_dir)
        self.meta = json.loads((model_dir / "traffic_gcn_meta.json").read_text())
        self.base = pd.read_csv(model_dir / "street_segments.csv")
        num = ["lanes_this_direction", "speed_kmh", "length_m"]
        self.base[num] = self.base[num].astype(float)
        self.hour_share = hour_share  # ASSUMPTION: share of daily volume in the simulated hour

        self.model = TrafficGCN(len(self.meta["feature_cols"]))
        self.model.load_state_dict(
            torch.load(
                model_dir / "traffic_gcn_checkpoint.pt",
                map_location="cpu",
                weights_only=True,
            )
        )
        self.model.eval()

        self._base_pts = self.base[self.ENDPOINTS].to_numpy()
        self._base_edges = self._build_edges(self.base)
        self.base_pred = self.predict(self.base)  # computed once
        logger.info("Predictor ready: %d segments", len(self.base))

    # ---- feature / graph construction (same recipes as the notebook) ----
    def _features(self, df: pd.DataFrame) -> torch.Tensor:
        bearing = np.deg2rad(df["travel_bearing_deg"].astype(float))
        parts = [
            df[["lanes_this_direction", "speed_kmh", "length_m"]].astype(float),
            df[["is_two_way", "has_bike_lane", "has_bike_facility", "bike_contraflow"]].astype(int),
            pd.get_dummies(df["road_class"], prefix="road_class").astype(float),
            pd.get_dummies(df["travel_direction_approx"], prefix="dir").astype(float),
            pd.Series(np.sin(bearing), name="bearing_sin", index=df.index),
            pd.Series(np.cos(bearing), name="bearing_cos", index=df.index),
        ]
        feat = pd.concat(parts, axis=1).reindex(columns=self.meta["feature_cols"], fill_value=0.0)
        X = feat.fillna(0.0).values.astype(np.float32)
        idx = self.meta["cont_idx"]
        X[:, idx] = (X[:, idx] - np.array(self.meta["mu"], dtype=np.float32)) / np.array(
            self.meta["sigma"], dtype=np.float32
        )
        return torch.tensor(X)

    @staticmethod
    def _build_edges(df: pd.DataFrame, precision: int = 6) -> torch.Tensor:
        at_pt: dict = {}
        for i, r in enumerate(df.itertuples()):
            for pt in (
                (round(r.start_lat, precision), round(r.start_lon, precision)),
                (round(r.end_lat, precision), round(r.end_lon, precision)),
            ):
                at_pt.setdefault(pt, []).append(i)
        pairs = {p for ids in at_pt.values() for p in itertools.combinations(sorted(set(ids)), 2)}
        src = [a for a, b in pairs] + [b for a, b in pairs]
        dst = [b for a, b in pairs] + [a for a, b in pairs]
        return torch.tensor([src, dst], dtype=torch.long)

    # ---- inference ----
    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        pts = df[self.ENDPOINTS].to_numpy()
        same_geometry = pts.shape == self._base_pts.shape and np.array_equal(pts, self._base_pts)
        edges = self._base_edges if same_geometry else self._build_edges(df)
        with torch.no_grad():
            scale = self.model(self._features(df), edges).numpy().clip(0, 1)
        out = df[["edge_id"]].copy()
        out["veh_per_day"] = scale * (self.meta["vol_max"] - self.meta["vol_min"]) + self.meta["vol_min"]
        out["veh_per_hour"] = out["veh_per_day"] * self.hour_share
        return out

    def apply_request_edits(self, edits) -> tuple[pd.DataFrame, list[str], list[str]]:
        """Map SimulationRequest edits onto the segment table.

        Returns (edited_df, closed_edge_ids, skipped_edge_ids). Edges that SUMO knows
        but the model table doesn't are skipped (reported, not an error).
        """
        df = self.base.copy()
        known = set(df["edge_id"])
        closed: list[str] = []
        skipped: list[str] = []
        for e in edits:
            if e.edge_id not in known:
                skipped.append(e.edge_id)
                continue
            mask = df["edge_id"] == e.edge_id
            if e.type == "set_speed_limit":
                df.loc[mask, "speed_kmh"] = e.speed_mps * 3.6
            elif e.type == "set_lane_count":
                df.loc[mask, "lanes_this_direction"] = float(e.lane_count)
            elif e.type == "close_edge":
                closed.append(e.edge_id)  # no feature for closure; zeroed after prediction
        return df, closed, skipped

    def predict_edited(self, edited: pd.DataFrame, closed=()) -> pd.DataFrame:
        """Full per-edge prediction for the edited table; closed edges forced to 0."""
        new = self.predict(edited)
        new.loc[new["edge_id"].isin(list(closed)), ["veh_per_day", "veh_per_hour"]] = 0.0
        return new

    def compare(
        self,
        new: pd.DataFrame,
        min_abs_change: float = 1.0,
        max_changes: int = 200,
    ) -> list[dict]:
        """Baseline vs edited prediction (output of predict_edited), only where the change is
        non-trivial. At most max_changes records, largest |delta| first."""
        merged = self.base_pred.merge(new, on="edge_id", suffixes=("_base", "_edited"))
        merged["delta_per_day"] = merged["veh_per_day_edited"] - merged["veh_per_day_base"]
        merged = merged[merged["delta_per_day"].abs() >= min_abs_change]
        merged = merged.reindex(
            merged["delta_per_day"].abs().sort_values(ascending=False).index
        )
        return merged.head(max_changes).round(1).to_dict("records")