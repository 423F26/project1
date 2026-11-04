"""One scheduler serializes legacy sentiment and report processes within one resource ceiling."""

import os
import signal
from pathlib import Path
import subprocess
import sys
import time
import analysis_worker as legacy


def run():
    db = legacy.open_db()
    legacy.recover_interrupted(db)
    db.execute(
        "UPDATE report_runs SET status='queued',stage='recovered' WHERE status='running'"
    )
    db.commit()
    library = legacy.DATA_DIR / "library"
    if library.exists():
        known = {r[0] for r in db.execute("SELECT filing_id FROM library_documents")}
        for path in library.iterdir():
            identity = path.name.split(".", 1)[0]
            if path.is_file() and (identity not in known or path.name.endswith(".tmp")):
                path.unlink(missing_ok=True)
        for fid in known:
            if (
                not (library / (fid + ".source")).is_file()
                or not (library / (fid + ".anchors.json")).is_file()
            ):
                db.execute("DELETE FROM library_documents WHERE filing_id=?", (fid,))
        db.commit()
    while True:
        report = db.execute(
            "SELECT id,created_at FROM report_runs WHERE status='queued' ORDER BY created_at,id LIMIT 1"
        ).fetchone()
        sentiment = db.execute(
            "SELECT id,created_at FROM analysis_jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1"
        ).fetchone()
        if not report and not sentiment:
            time.sleep(2)
            continue
        is_report = bool(
            report
            and (not sentiment or report["created_at"] <= sentiment["created_at"])
        )
        name = "report_worker.py" if is_report else "analysis_worker.py"
        args = [sys.executable, str(Path(__file__).with_name(name))]
        if not is_report:
            args.append("--once")
        # A separate process releases all model memory before the next run.
        child = subprocess.Popen(args, start_new_session=True)
        try:
            code = child.wait(timeout=3600)
            if code:
                raise RuntimeError("Worker process exited with code " + str(code))
        except (subprocess.TimeoutExpired, RuntimeError) as e:
            if is_report:
                r = db.execute(
                    "SELECT payload FROM report_runs WHERE id=?", (report["id"],)
                ).fetchone()
                status = "partial" if r and r["payload"] else "unavailable"
                db.execute(
                    "UPDATE report_runs SET status=?,stage=?,error=?,completed_at=? WHERE id=?",
                    (
                        status,
                        "finished",
                        str(e),
                        time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        report["id"],
                    ),
                )
            else:
                db.execute(
                    "UPDATE analysis_jobs SET status='failed',error=? WHERE id=?",
                    (str(e), sentiment["id"]),
                )
            db.commit()
        finally:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()


if __name__ == "__main__":
    run()
