"""Run an explicitly selected cached filing pair and record local resource observations."""

import argparse
import json
from pathlib import Path
import resource
import os
import signal
import subprocess
import sys
import time
import uuid
import analysis_worker as legacy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--primary", required=True, help="Cached filing ID")
    parser.add_argument(
        "--prior", required=True, help="Cached comparable prior filing ID"
    )
    parser.add_argument(
        "--output", required=True, help="JSON result path, outside the source tree"
    )
    args = parser.parse_args()
    db = legacy.open_db()
    filings = [
        db.execute("SELECT * FROM company_filings WHERE id=?", (fid,)).fetchone()
        for fid in (args.primary, args.prior)
    ]
    if (
        any(f is None for f in filings)
        or filings[0]["company_id"] != filings[1]["company_id"]
        or not filings[0]["form_type"]
        or filings[0]["form_type"] != filings[1]["form_type"]
        or not filings[1]["report_date"]
        or filings[1]["report_date"] >= filings[0]["report_date"]
    ):
        parser.error("Choose a cached, comparable current/prior pair for one company.")
    if db.execute(
        "SELECT 1 FROM report_runs WHERE status IN ('queued','running')"
    ).fetchone():
        parser.error(
            "Stop the scheduler and finish other queued reports before benchmarking."
        )
    rid = str(uuid.uuid4())
    db.execute(
        "INSERT INTO report_runs(id,company_id,primary_id,prior_id,filing_ids,status,stage,created_at) VALUES(?,?,?,?,?,'queued','benchmark',?)",
        (
            rid,
            filings[0]["company_id"],
            args.primary,
            args.prior,
            json.dumps([args.primary, args.prior]),
            time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        ),
    )
    db.commit()
    started = time.monotonic()
    process = subprocess.Popen(
        [sys.executable, str(Path(__file__).with_name("report_worker.py"))],
        start_new_session=True,
    )
    try:
        code = process.wait(timeout=3600)
    except subprocess.TimeoutExpired:
        code = -1
    finally:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
    if code != 0:
        previous = db.execute(
            "SELECT payload FROM report_runs WHERE id=?", (rid,)
        ).fetchone()
        db.execute(
            "UPDATE report_runs SET status=?,stage=?,error=?,completed_at=? WHERE id=?",
            (
                "partial" if previous["payload"] else "unavailable",
                "finished",
                "Benchmark process failed or exceeded the one-hour deadline.",
                time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                rid,
            ),
        )
        db.commit()
    row = db.execute(
        "SELECT status,error,payload FROM report_runs WHERE id=?", (rid,)
    ).fetchone()
    result = {
        "reportId": rid,
        "elapsedSeconds": round(time.monotonic() - started, 2),
        "peakChildKiB": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
        "exitCode": code,
        "status": row["status"],
        "error": row["error"],
        "coverage": json.loads(row["payload"]).get("coverage")
        if row["payload"]
        else None,
        "qualityApproved": False,
        "note": "Memory is an observed child-process peak, not a hard limit. Run in the Compose 8 GiB / 4 CPU container. Team review of evidence and both languages is still required.",
    }
    Path(args.output).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return (
        0
        if code == 0
        and result["status"] in {"partial", "complete"}
        and result["coverage"]
        and result["coverage"]["reviewed"] > 0
        else 1
    )


if __name__ == "__main__":
    sys.exit(main())
