import importlib.util
import io
import json
import sqlite3
from contextlib import nullcontext, redirect_stderr
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

    def test_german_publication_uses_viewer_content_endpoint_without_analyzing_page_shell(self):
        job = {"market": "DE", "filing_url": "https://www.unternehmensregister.de/de/publication?payload=abc%2B123"}
        shell = ("<html><p>" + "navigation metadata " * 70 + "</p></html>").encode()
        document = ("<table><tr><td>" + "Aktien wurden erworben. " * 60 + "</td></tr></table>").encode()
        endpoint = "https://www.unternehmensregister.de/api/pub-html?payload=abc%2B123"
        with patch.object(worker, "fetch_document", side_effect=[(shell, "text/html"), (document, "text/plain")]) as fetch:
            source, text, urls = worker.filing_text(job)
        fetch.assert_called_with(job, endpoint)
        self.assertEqual(urls, [endpoint])
        self.assertIn(document, source)
        self.assertIn("Aktien wurden erworben.", text)
        self.assertNotIn("navigation", text)
        for content in [b"<html><p>Bitte melden Sie sich an</p></html>", b"<html><p>Loading</p></html>"]:
            with self.subTest(content=content), patch.object(worker, "fetch_document", side_effect=[(shell, "text/html"), (content, "text/html")]):
                with self.assertRaises(worker.Unavailable):
                    worker.filing_text(job)

    def test_german_embedded_publication_is_extracted_without_fetching_missing_document_endpoint(self):
        body = '<p>Gläubiger erhalten "Sicherheit". ÄÖÜß &amp; Rechte. </p>' * 30
        stream = 'd:' + json.dumps({"publication": {"publicationText": body}})
        chunks = [stream[:150], stream[150:]]
        source = ('<p>navigation metadata</p>' + ''.join(
            '<script>self.__next_f.push(' + json.dumps([1, chunk]) + ')</script>' for chunk in chunks)).encode()
        job = {"market": "DE", "filing_url": "https://www.unternehmensregister.de/de/publication?payload=abc"}
        with patch.object(worker, "fetch_document", return_value=(source, "text/html")) as fetch:
            original, text, urls = worker.filing_text(job)
        fetch.assert_called_once_with(job)
        self.assertEqual(original, source)
        self.assertEqual(urls, [job["filing_url"]])
        self.assertIn('Gläubiger erhalten "Sicherheit". ÄÖÜß & Rechte.', text)
        self.assertNotIn("navigation", text)

    def test_short_embedded_notice_reports_insufficient_text_instead_of_download_failure(self):
        stream = json.dumps({"publication": {"publicationText": "Mitteilung " * 86}})
        source = ('<script>self.__next_f.push(' + json.dumps([1, stream]) + ')</script>').encode()
        job = {"market": "DE", "filing_url": "https://www.unternehmensregister.de/de/publication?payload=abc"}
        with patch.object(worker, "fetch_document", return_value=(source, "text/html")) as fetch:
            with self.assertRaisesRegex(worker.Unavailable, "too little readable text"):
                worker.filing_text(job)
        fetch.assert_called_once_with(job)
        for source in [b'<p>listing metadata</p>', b'<script>self.__next_f.push(invalid)</script>',
                       b'<script>self.__next_f.push([1, "\\\"publicationText\\\":\\\"\\\\xinvalid\\\""])</script>']:
            self.assertEqual(worker.german_publication(source), {})

    def test_german_content_fetch_is_limited_to_the_selected_publication_payload(self):
        job = {"market": "DE", "filing_url": "https://www.unternehmensregister.de/de/publication?payload=abc"}
        endpoint = worker.german_content_url(job)
        response = SimpleNamespace(geturl=lambda: endpoint, headers=SimpleNamespace(get_content_type=lambda: "text/plain"),
                                   read=unittest.mock.Mock(side_effect=[b"document", b""]))
        opener = SimpleNamespace(open=unittest.mock.Mock(return_value=nullcontext(response)))
        with patch.object(worker.urllib.request, "build_opener", return_value=opener):
            self.assertEqual(worker.fetch_document(job, endpoint), (b"document", "text/plain"))
            for target in [endpoint + "other", endpoint.replace("/pub-html", "/other"), endpoint.replace("www.unternehmensregister.de", "example.com")]:
                with self.subTest(target=target), self.assertRaises(worker.Unavailable):
                    worker.fetch_document(job, target)
        self.assertEqual(opener.open.call_count, 1)
        for path in ["/de/deposits?payload=abc", "/de/publication?payload=abc&payload=def", "/de/publication?payload="]:
            self.assertIsNone(worker.german_content_url({**job, "filing_url": "https://www.unternehmensregister.de" + path}))

    def test_passages_are_split_without_losing_source_characters(self):
        text = "abcdefghij"
        chunks = worker.chunk_text(TinyTokenizer(), text, max_tokens=4)
        self.assertEqual("".join(chunks), text)

    def test_translation_tokenizer_without_offsets_uses_bounded_chunks_without_losing_text(self):
        def tokenizer(text, **_kwargs):
            return {"input_ids": list(range(len(text)))}
        text = "Der Umsatz ist gestiegen. ÄÖÜß\n" * 70
        chunks = worker.chunk_text(tokenizer, text, max_tokens=448)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(0 < len(chunk) <= 500 for chunk in chunks))
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

    def test_translation_model_loading_is_reported_as_translating(self):
        with tempfile.TemporaryDirectory() as temp:
            db = sqlite3.connect(":memory:")
            db.row_factory = sqlite3.Row
            db.executescript((MODULE.parent / "analysis-schema.sql").read_text())
            db.execute("INSERT INTO analysis_jobs (id, source_key, market, filing_url, title, status, created_at, updated_at) VALUES ('id', 'key', 'DE', 'https://www.unternehmensregister.de/de/publication?payload=abc', 'title', 'fetching', '2026-01-01', '2026-01-01')")
            job = db.execute("SELECT * FROM analysis_jobs").fetchone()
            with patch.object(worker, "SOURCE_DIR", Path(temp)), patch.object(worker, "TEMP_DIR", Path(temp)), \
                 patch.object(worker, "filing_text", return_value=(b"source", "financial statement " * 70, [job["filing_url"]])), \
                 patch.object(worker, "ensure_translation", side_effect=RuntimeError("model loading failed")):
                with self.assertRaises(RuntimeError):
                    worker.process(db, job, [None] * 5)
            self.assertEqual(db.execute("SELECT status FROM analysis_jobs").fetchone()[0], "translating")
            self.assertEqual(list(Path(temp).iterdir()), [])
            db.close()

    def test_english_publications_bypass_translation_and_report_only_models_used_by_this_job(self):
        passage = ("Revenue increased and operating costs declined. " * 4).strip()
        for market, language, cached in [("DE", "en", False), ("DE", "en", True), ("DE", "de", False),
                                          ("DE", None, False), ("US", None, True)]:
            with self.subTest(market=market, language=language, cached=cached), tempfile.TemporaryDirectory() as temp:
                db = sqlite3.connect(":memory:")
                db.row_factory = sqlite3.Row
                db.executescript((MODULE.parent / "analysis-schema.sql").read_text())
                db.execute("INSERT INTO analysis_jobs (id, source_key, market, filing_url, title, status, created_at, updated_at) VALUES ('id', 'key', ?, 'https://www.unternehmensregister.de/de/publication?payload=abc', 'title', 'fetching', '2026-01-01', '2026-01-01')", (market,))
                job = db.execute("SELECT * FROM analysis_jobs").fetchone()
                stream = json.dumps({"language": "de", "publication": {"language": language, "publicationText": None}})
                source = ('<script>self.__next_f.push(' + json.dumps([1, stream]) + ')</script>').encode()
                translator = SimpleNamespace(config=SimpleNamespace(_commit_hash="translation-revision"))
                classifier = SimpleNamespace(config=SimpleNamespace(_commit_hash="classifier-revision"))
                models = [None, TinyTokenizer(), classifier, translator if cached else None, TinyTokenizer() if cached else None]
                with patch.object(worker, "SOURCE_DIR", Path(temp)), patch.object(worker, "TEMP_DIR", Path(temp)), \
                     patch.object(worker, "filing_text", return_value=(source, passage, [job["filing_url"]])), \
                     patch.object(worker, "ensure_translation", return_value=(translator, TinyTokenizer())) as load, \
                     patch.object(worker, "translate_text", return_value="Translated financial statement.") as translate, \
                     patch.object(worker, "classify", return_value={"label": "neutral"}) as classify:
                    worker.process(db, job, models)
                result = json.loads((Path(temp) / "id.result.json").read_text())
                self.assertEqual(db.execute("SELECT status FROM analysis_jobs").fetchone()[0], "complete")
                needs_translation = market == "DE" and language != "en"
                self.assertEqual(load.call_count, int(needs_translation))
                self.assertEqual(translate.call_count, int(needs_translation))
                classify.assert_called_once()
                self.assertEqual(classify.call_args.args[-1], "Translated financial statement." if needs_translation else passage)
                self.assertEqual(result["passages"][0]["original"], passage)
                self.assertEqual(result["passages"][0]["translation"], "Translated financial statement." if needs_translation else None)
                self.assertEqual(result["translation_model"], worker.TRANSLATION_ID if needs_translation else None)
                self.assertEqual(result["translation_revision"], "translation-revision" if needs_translation else None)
                db.close()

    def test_unexpected_failure_records_stage_and_logs_traceback_without_exposing_details_in_ui(self):
        with tempfile.TemporaryDirectory() as temp:
            db = sqlite3.connect(":memory:")
            db.row_factory = sqlite3.Row
            db.executescript((MODULE.parent / "analysis-schema.sql").read_text())
            db.execute("INSERT INTO analysis_jobs (id, source_key, market, filing_url, title, status, created_at, updated_at) VALUES ('id', 'key', 'DE', 'https://www.unternehmensregister.de/de/publication?payload=abc', 'title', 'queued', '2026-01-01', '2026-01-01')")
            job = db.execute("SELECT * FROM analysis_jobs").fetchone()
            def fail(*_args):
                db.execute("UPDATE analysis_jobs SET status='translating' WHERE id='id'")
                db.commit()
                raise TypeError("internal model diagnostic")
            logs = io.StringIO()
            with patch.dict(worker.sys.modules, {"torch": SimpleNamespace(backends=SimpleNamespace())}), \
                 patch.object(worker, "open_db", return_value=db), patch.object(worker, "SOURCE_DIR", Path(temp)), \
                 patch.object(worker, "TEMP_DIR", Path(temp)), patch.object(worker, "load_models", return_value=[None] * 5), \
                 patch.object(worker, "claim", side_effect=[job, KeyboardInterrupt]), \
                 patch.object(worker, "process", side_effect=fail), redirect_stderr(logs):
                with self.assertRaises(KeyboardInterrupt):
                    worker.run()
            row = db.execute("SELECT status, error FROM analysis_jobs").fetchone()
            self.assertEqual(row["status"], "failed")
            self.assertIn("during translating (TypeError)", row["error"])
            self.assertNotIn("internal model diagnostic", row["error"])
            self.assertIn("Traceback", logs.getvalue())
            self.assertIn("TypeError: internal model diagnostic", logs.getvalue())
            db.close()

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
