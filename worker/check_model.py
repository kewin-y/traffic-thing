from pathlib import Path
from types import SimpleNamespace as NS
import numpy as np
from src.traffic_worker.predictor import Predictor
import re
from pathlib import Path

p = Predictor(Path(__file__).parent / "model")
# unit check: predictions should track the real volumes closely (in-sample, so should be high)
print("corr:", np.corrcoef(p.base_pred.veh_per_day, p.base.volume_vehicle_daily_per_dir_est)[0, 1])

top = p.base_pred.sort_values("veh_per_day").iloc[-1].edge_id
lanes = p.base.loc[p.base.edge_id == top, "lanes_this_direction"].iloc[0]
print("busiest edge:", top, "lanes:", lanes)

edited, closed, skipped = p.apply_request_edits([NS(type="set_lane_count", edge_id=top, lane_count=int(lanes) + 1)])
print(p.compare(p.predict_edited(edited, closed))[:5])
print(p.predict_edited(edited, closed).query("edge_id == @top"))   # should be 0
print("edge-entries/hour:", p.base_pred.veh_per_hour.sum())
demand = Path(__file__).parent.parent / "networks" / "toronto-downtown" / "demand.rou.xml"
txt = demand.read_text()
routes = re.findall(r'edges="([^"]+)"', txt)
mean_len = sum(len(r.split()) for r in routes) / len(routes)
print("mounted demand: vehicles", txt.count("<vehicle"), "| mean edges/route", round(mean_len, 1))
print("model-implied vehicles/hour:", round(p.base_pred.veh_per_hour.sum() / mean_len))