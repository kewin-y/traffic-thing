from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class RoadEdit(StrictModel):
    edge_id: str = Field(min_length=1, max_length=256)


class SetSpeedLimit(RoadEdit):
    type: Literal["set_speed_limit"]
    speed_mps: float = Field(gt=0, le=70)


class SetLaneCount(RoadEdit):
    type: Literal["set_lane_count"]
    lane_count: int = Field(ge=1, le=8)


class CloseEdge(RoadEdit):
    type: Literal["close_edge"]


Edit = Annotated[SetSpeedLimit | SetLaneCount | CloseEdge, Field(discriminator="type")]


class SimulationRequest(StrictModel):
    network: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")
    duration_seconds: int = Field(default=3600, ge=1, le=3600)
    seed: int = Field(default=42, ge=0, le=2147483647)
    edits: list[Edit] = Field(default_factory=list, max_length=100)
    record: bool = False
    sample_interval_seconds: int = Field(default=5, ge=1, le=60)

    @model_validator(mode="after")
    def reject_conflicting_edits(self) -> "SimulationRequest":
        seen: dict[str, set[str]] = {}
        for edit in self.edits:
            types = seen.setdefault(edit.edge_id, set())
            if edit.type in types:
                raise ValueError(f"Duplicate {edit.type} edit for edge {edit.edge_id}")
            types.add(edit.type)
            if "close_edge" in types and len(types) > 1:
                raise ValueError(f"Closure cannot be combined with other edits for {edit.edge_id}")
        return self
