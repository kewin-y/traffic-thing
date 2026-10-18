"""Persistent, atomic result receipts for retrying the same HTTP run safely."""
import fcntl
import hashlib
import json
from contextlib import contextmanager
from pathlib import Path


class ReceiptBusy(Exception):
    pass


class ReceiptConflict(Exception):
    pass


class Receipt:
    def __init__(self, path: Path, fingerprint: str):
        self.path = path
        self.fingerprint = fingerprint
        self.cached = None
        if path.exists():
            data = json.loads(path.read_text())
            if data["fingerprint"] != fingerprint:
                raise ReceiptConflict
            self.cached = data

    def store(self, body: dict, status: int = 200):
        temporary = self.path.with_suffix(".partial")
        temporary.write_text(json.dumps({"fingerprint": self.fingerprint, "body": body, "status": status}, allow_nan=False))
        temporary.replace(self.path)


@contextmanager
def claim_receipt(root: Path, request_id: str | None, payload: dict):
    if request_id is None:
        yield None
        return
    root.mkdir(parents=True, exist_ok=True)
    identifier = hashlib.sha256(request_id.encode()).hexdigest()
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    # flock releases on process death; a duplicate in flight never starts SUMO again.
    with (root / f"{identifier}.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ReceiptBusy from None
        try:
            yield Receipt(root / f"{identifier}.json", fingerprint)
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
