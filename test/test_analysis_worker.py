import importlib.util
import sqlite3
from contextlib import nullcontext
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

MODULE = Path(__file__).parents[1] / "src" / "analysis_worker.py"
spec = importlib.util.spec_from_file_location("analysis_worker", MODULE)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class TinyTokenizer:
    def __call__(self, text, **kwargs):
        offsets = [(0, 0)] + [(index, index + 1) for index in range(len(text))] + [(0, 0)]
        return {"offset_mapping": offsets}


class AnalysisWorkerTests(unittest.TestCase):
    def test_source_urls_are_limited_to_known_publishers_and_records(self):
        sec = {"market": "US", "cik": "0000320193", "accession": "0000320193-26-000001",
               "filing_url": "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/a.htm"}
        self.assertEqual(worker.safe_url(sec), sec["filing_url"])
        sec["filing_url"] = "https://example.com/Archives/edgar/data/320193/000032019326000001/a.htm"
        with self.assertRaises(worker.Unavailable):
            worker.safe_url(sec)

    def test_extraction_strips_script_content_and_marks_short_content_unavailable(self):
        source = ("<html><script>do not extract this</script><p>" + "financial evidence " * 60 + "</p></html>").encode()
        text = worker.extract_document(source, "text/html")
        self.assertNotIn("do not extract", text)
        self.assertIn("financial evidence", text)
        with self.assertRaises(worker.Unavailable):
            worker.extract_document(b"too short", "text/plain")

    def test_german_result_analyzes_linked_documents_not_listing_text(self):
        listing = ("<html><p>" + "listing metadata " * 70 + "</p>"
                   "<a href='/de/publication/123/report.pdf?download=1'>PDF</a>"
                   "<a href='https://example.org/report.pdf'>external</a></html>").encode()
        document_text = ("financial statement " * 70).encode()
        job = {"market": "DE", "filing_url": "https://www.unternehmensregister.de/de/publication/123"}
        with patch.object(worker, "fetch_document", side_effect=[(listing, "text/html"), (document_text, "text/plain")]):
            source, text, urls = worker.filing_text(job)
        self.assertIn("financial statement", text)
        self.assertNotIn("listing metadata", text)
        self.assertEqual(urls, ["https://www.unternehmensregister.de/de/publication/123/report.pdf?download=1"])
        self.assertIn(document_text, source)

    def test_german_listing_without_a_retrievable_document_is_unavailable(self):
        listing = ("<html><p>" + "listing metadata " * 70 + "</p></html>").encode()
        job = {"market": "DE", "filing_url": "https://www.unternehmensregister.de/de/publication/123"}
        with patch.object(worker, "fetch_document", return_value=(listing, "text/html")):
            with self.assertRaises(worker.Unavailable):
                worker.filing_text(job)

    def test_passages_are_split_without_losing_source_characters(self):
        text = "abcdefghij"
        chunks = worker.chunk_text(TinyTokenizer(), text, max_tokens=4)
        self.assertEqual("".join(chunks), text)

    def test_finbert_label_mapping_returns_all_three_probabilities(self):
        class Scores:
            shape = (1, 3)
            def __getitem__(self, _index): return self
            def tolist(self): return [0.1, 0.8, 0.1]
        class Torch:
            inference_mode = staticmethod(nullcontext)
            softmax = staticmethod(lambda _logits, dim: Scores())
        class Model:
            def __call__(self, **_inputs): return SimpleNamespace(logits=Scores())
        class Tokenizer:
            def __call__(self, *_args, **_kwargs): return {"input_ids": SimpleNamespace(shape=(1, 4))}
        result = worker.classify(Torch(), Tokenizer(), Model(), "falling revenue")
        self.assertEqual(result["label"], "negative")
        self.assertEqual(set(result["scores"]), {"positive", "negative", "neutral"})

    def test_interrupted_jobs_return_to_queue_after_restart(self):
        db = sqlite3.connect(":memory:")
        db.executescript((MODULE.parent / "analysis-schema.sql").read_text())
        db.execute("INSERT INTO analysis_jobs (id, source_key, market, filing_url, title, status, created_at, updated_at) VALUES ('id', 'key', 'US', 'https://www.sec.gov/x', 'title', 'classifying', '2026-01-01', '2026-01-01')")
        worker.recover_interrupted(db)
        self.assertEqual(db.execute("SELECT status FROM analysis_jobs WHERE id='id'").fetchone()[0], "queued")

    def test_quota_prunes_oldest_completed_jobs_only(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temp:
            previous_source, previous_limit = worker.SOURCE_DIR, worker.MAX_STORAGE
            worker.SOURCE_DIR = Path(temp)
            worker.MAX_STORAGE = 10
            try:
                db = sqlite3.connect(":memory:")
                db.row_factory = sqlite3.Row
                db.executescript((MODULE.parent / "analysis-schema.sql").read_text())
                for job_id, date, status, size in [
                    ("old", "2026-01-01", "complete", 5),
                    ("new", "2026-02-01", "complete", 5),
                    ("active", "2026-03-01", "classifying", 0),
                ]:
                    db.execute("INSERT INTO analysis_jobs (id, source_key, market, filing_url, title, status, artifact_bytes, created_at, updated_at, completed_at) VALUES (?, ?, 'US', 'https://www.sec.gov/x', ?, ?, ?, ?, ?, ?)",
                               (job_id, job_id, job_id, status, size, date, date, date if status == "complete" else ""))
                    (worker.SOURCE_DIR / f"{job_id}.source").write_text("artifact")
                db.commit()
                self.assertTrue(worker.prune_for(db, 5, "active"))
                remaining = {row[0] for row in db.execute("SELECT id FROM analysis_jobs")}
                self.assertEqual(remaining, {"new", "active"})
                self.assertFalse((worker.SOURCE_DIR / "old.source").exists())
                self.assertTrue((worker.SOURCE_DIR / "new.source").exists())
                self.assertTrue((worker.SOURCE_DIR / "active.source").exists())
            finally:
                worker.SOURCE_DIR, worker.MAX_STORAGE = previous_source, previous_limit


if __name__ == "__main__":
    unittest.main()
