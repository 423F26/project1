"""Private, single-process CPU worker for local filing sentiment analysis."""

from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import sys
import time
import traceback
import urllib.error
import urllib.request
import uuid
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit

MAX_DOWNLOAD = 25 * 1024 * 1024
MAX_TEXT_CHARS = 2_000_000
MAX_STORAGE = int(os.environ.get("MAX_ANALYSIS_STORAGE_BYTES", 25 * 1024**3))
DATA_DIR = Path(os.environ.get("ANALYSIS_DATA_DIR", "data/analysis"))
DB_PATH = Path(os.environ.get("ANALYSIS_DB_PATH", str(DATA_DIR / "analysis.sqlite")))
SOURCE_DIR = DATA_DIR / "documents"
TEMP_DIR = DATA_DIR / "tmp"
FINBERT_ID = "ProsusAI/finbert"
TRANSLATION_ID = "Helsinki-NLP/opus-mt-de-en"
MODEL_CACHE = Path(os.environ.get("MODEL_CACHE", "data/models"))
SEC_AGENT = os.environ.get("SEC_USER_AGENT", "FinancialBiasDetector/0.2.1 (charles.smith26@student.montana.edu)")
ACCESSION = re.compile(r"^\d{10}-\d{2}-\d{6}$")
CIK = re.compile(r"^\d{10}$")
BLOCK_TAGS = {"p", "div", "section", "article", "li", "tr", "td", "th", "h1", "h2", "h3", "h4", "br"}
SKIP_TAGS = {"script", "style", "svg", "noscript", "head"}


class Unavailable(Exception):
    """The referenced document cannot be safely analyzed as received."""


class SameHostRedirect(urllib.request.HTTPRedirectHandler):
    max_redirections = 3
    max_repeats = 3

    def redirect_request(self, request: Any, response: Any, code: int, message: str,
                         headers: Any, new_url: str) -> Any:
        from urllib.parse import urlparse

        old, new = urlparse(request.full_url), urlparse(new_url)
        if new.scheme != "https" or new.netloc != old.netloc:
            raise Unavailable("The filing redirected outside its publisher host.")
        return super().redirect_request(request, response, code, message, headers, new_url)


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in SKIP_TAGS:
            self.skip += 1
        elif not self.skip and tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in SKIP_TAGS and self.skip:
            self.skip -= 1
        elif not self.skip and tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.parts.append(data)


class DocumentLinks(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)


def safe_url(job: sqlite3.Row) -> str:
    from urllib.parse import urlsplit

    url = urlsplit(job["filing_url"])
    if url.scheme != "https" or url.username or url.password or url.fragment:
        raise Unavailable("The filing URL is invalid.")
    if job["market"] == "US":
        if url.hostname != "www.sec.gov" or not CIK.fullmatch(job["cik"] or "") or not ACCESSION.fullmatch(job["accession"] or ""):
            raise Unavailable("The SEC filing reference is invalid.")
        directory = job["accession"].replace("-", "")
        prefix = f"/Archives/edgar/data/{int(job['cik'])}/{directory}/"
        filename = url.path[len(prefix):] if url.path.startswith(prefix) else ""
        if not filename or "/" in filename or ".." in filename or not re.fullmatch(r"[A-Za-z0-9._-]+", filename) or url.query:
            raise Unavailable("The SEC filing location is invalid.")
    elif job["market"] == "DE":
        if url.hostname != "www.unternehmensregister.de" or not re.match(r"^/de/(?:publication|deposits|registerPortalAdvice)(?:/|$)", url.path):
            raise Unavailable("The German register reference is invalid.")
    else:
        raise Unavailable("The filing market is unsupported.")
    return job["filing_url"]


def german_content_url(job: sqlite3.Row) -> str | None:
    url = urlsplit(safe_url(job))
    payloads = parse_qs(url.query).get("payload", [])
    if job["market"] == "DE" and url.path == "/de/publication" and len(payloads) == 1:
        return "https://www.unternehmensregister.de/api/pub-html?" + urlencode({"payload": payloads[0]})
    return None


def fetch_document(job: sqlite3.Row, target_url: str | None = None) -> tuple[bytes, str]:
    url = safe_url(job)
    if target_url:
        parsed = urlsplit(target_url)
        if job["market"] != "DE" or parsed.scheme != "https" or parsed.netloc != "www.unternehmensregister.de" or parsed.fragment or not (re.match(r"^/de/(?:publication|deposits|registerPortalAdvice)(?:/|$)", parsed.path) or target_url == german_content_url(job)):
            raise Unavailable("The linked document is outside the German register.")
        url = target_url
    headers = {"User-Agent": SEC_AGENT if job["market"] == "US" else "FinancialBiasDetector/0.2.1",
               "Accept": "text/html,application/xhtml+xml,application/pdf,text/plain,application/xml"}
    opener = urllib.request.build_opener(SameHostRedirect())
    try:
        with opener.open(urllib.request.Request(url, headers=headers), timeout=20) as response:
            final = response.geturl()
            if final.split("/", 3)[:3] != url.split("/", 3)[:3]:
                raise Unavailable("The filing redirected outside its publisher host.")
            content_type = response.headers.get_content_type().lower()
            chunks, size = [], 0
            while True:
                block = response.read(64 * 1024)
                if not block:
                    break
                size += len(block)
                if size > MAX_DOWNLOAD:
                    raise Unavailable("The filing exceeds the 25 MiB download limit.")
                chunks.append(block)
            return b"".join(chunks), content_type
    except Unavailable:
        raise
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise Unavailable("The filing could not be retrieved.") from error


def extract_document(data: bytes, content_type: str, *, require_minimum: bool = True) -> str:
    if data.startswith(b"%PDF-") or content_type == "application/pdf":
        try:
            from pypdf import PdfReader

            reader = PdfReader(__import__("io").BytesIO(data), strict=True)
            if reader.is_encrypted or len(reader.pages) > 1000:
                raise Unavailable("The PDF is encrypted or exceeds the page limit.")
            parts = []
            total = 0
            for page in reader.pages:
                page_text = page.extract_text(extraction_mode="layout") or ""
                total += len(page_text)
                if total > MAX_TEXT_CHARS:
                    raise Unavailable("The filing exceeds the 2 million character extraction limit.")
                parts.append(page_text)
            text = "\n".join(parts)
        except Unavailable:
            raise
        except Exception as error:
            raise Unavailable("The PDF text could not be extracted.") from error
    elif content_type in {"text/html", "application/xhtml+xml", "application/xml", "text/xml", "text/plain"} or data.lstrip().startswith((b"<", b"<?xml")):
        try:
            source = data.decode("utf-8-sig", errors="replace")
            parser = TextExtractor()
            parser.feed(source)
            text = "\n".join(parser.parts)
            lowered = text.lower()
            if any(term in lowered for term in ("please log in to", "please sign in to", "bitte melden sie sich an", "zur anmeldung", "registrierung erforderlich")) and len(text) < 5000:
                raise Unavailable("The source requires registration to view the document.")
        except Unavailable:
            raise
        except Exception as error:
            raise Unavailable("The filing text could not be extracted.") from error
    else:
        raise Unavailable("This document format is not supported for text extraction.")
    text = re.sub(r"[\t\r\f\v ]+", " ", text)
    text = re.sub(r" *\n+ *", "\n", text).strip()
    if len(text) > MAX_TEXT_CHARS:
        raise Unavailable("The filing exceeds the 2 million character extraction limit.")
    if require_minimum and len(text.split()) < 100:
        raise Unavailable("The filing contains too little readable text for a complete review.")
    return text


def german_publication(source: bytes) -> dict[str, Any]:
    chunks = []
    for script in re.findall(r"<script\b[^>]*>(.*?)</script\s*>", source.decode("utf-8-sig", errors="replace"), re.S | re.I):
        prefix = "self.__next_f.push("
        if not script.startswith(prefix):
            continue
        try:
            chunk, _ = json.JSONDecoder().raw_decode(script[len(prefix):])
        except ValueError:
            continue
        if isinstance(chunk, list) and len(chunk) == 2 and chunk[0] == 1 and isinstance(chunk[1], str):
            chunks.append(chunk[1])
    # Read the selected publication's metadata and body; never execute page scripts.
    stream = "".join(chunks)
    publications = []
    for match in re.finditer(r'"publication"\s*:\s*', stream):
        try:
            publication, _ = json.JSONDecoder().raw_decode(stream[match.end():])
        except ValueError:
            continue
        if isinstance(publication, dict):
            publications.append(publication)
    return publications[0] if len(publications) == 1 else {}


def filing_text(job: sqlite3.Row) -> tuple[bytes, str, list[str]]:
    source, content_type = fetch_document(job)
    if job["market"] != "DE" or content_type not in {"text/html", "application/xhtml+xml"}:
        return source, extract_document(source, content_type), [job["filing_url"]]

    embedded = german_publication(source).get("publicationText")
    if isinstance(embedded, str) and embedded:
        return source, extract_document(embedded.encode("utf-8"), "text/html"), [job["filing_url"]]

    links = DocumentLinks()
    links.feed(source.decode("utf-8-sig", errors="replace"))
    base = urlsplit(job["filing_url"])
    candidates = []
    for href in links.links:
        target = urljoin(job["filing_url"], href)
        parsed = urlsplit(target)
        if parsed.hostname != base.hostname or parsed.scheme != "https" or not re.search(r"\.(?:pdf|xhtml?|xml|txt|docx?|xlsx?|csv|zip|tiff?)$", parsed.path, re.I):
            continue
        if target not in candidates:
            candidates.append(target)
            if len(candidates) > 5:
                raise Unavailable("The German result links to too many filing documents for a complete review.")
    if not candidates:
        # The register's publication viewer loads its document from this public endpoint.
        content_url = german_content_url(job)
        if not content_url:
            raise Unavailable("The German result page contains no directly retrievable filing document.")
        candidates.append(content_url)

    texts, sources, urls = [], [source], []
    total = len(source)
    for target in candidates:
        data, kind = fetch_document(job, target)
        text = extract_document(data, kind, require_minimum=False)
        total += len(data)
        if total > MAX_DOWNLOAD:
            raise Unavailable("The German filing documents exceed the 25 MiB download limit.")
        texts.append(text)
        sources.append(data)
        urls.append(target)
    text = "\n\n".join(texts)
    if len(text.split()) < 100:
        raise Unavailable("The German filing documents contain too little readable text for a complete review.")
    return b"\n\n--- linked filing document ---\n\n".join(sources), text, urls


def paragraphs(text: str) -> list[str]:
    result: list[str] = []
    for paragraph in re.split(r"\n{2,}", text):
        paragraph = re.sub(r"\s+", " ", paragraph).strip()
        if len(paragraph) < 100:
            continue
        if len(paragraph) <= 5000:
            result.append(paragraph)
            continue
        sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9(\"'])", paragraph)
        current = ""
        for sentence in sentences:
            if current and len(current) + len(sentence) + 1 > 3500:
                result.append(current)
                current = ""
            current = f"{current} {sentence}".strip()
        if current:
            result.append(current)
    if not result:
        raise Unavailable("No reviewable passages were extracted.")
    return result


def open_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=5000")
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript(Path(__file__).with_name("analysis-schema.sql").read_text(encoding="utf-8"))
    return db


def claim(db: sqlite3.Connection) -> sqlite3.Row | None:
    db.execute("BEGIN IMMEDIATE")
    row = db.execute("SELECT * FROM analysis_jobs WHERE status='queued' ORDER BY created_at, id LIMIT 1").fetchone()
    if row:
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        db.execute("UPDATE analysis_jobs SET status='fetching', error='', updated_at=? WHERE id=?", (now, row["id"]))
    db.commit()
    return row


def set_status(db: sqlite3.Connection, job_id: str, status: str, *, error: str = "", result_path: str = "", artifact_bytes: int = 0) -> None:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    completed = now if status in {"complete", "unavailable", "failed"} else ""
    db.execute("UPDATE analysis_jobs SET status=?, error=?, result_path=?, artifact_bytes=?, updated_at=?, completed_at=? WHERE id=?",
               (status, error, result_path, artifact_bytes, now, completed, job_id))
    db.commit()


def prune_for(db: sqlite3.Connection, bytes_needed: int, protect_id: str) -> bool:
    if bytes_needed > MAX_STORAGE:
        return False
    total = db.execute("SELECT COALESCE(SUM(artifact_bytes),0) FROM analysis_jobs WHERE status='complete'").fetchone()[0]
    while total + bytes_needed > MAX_STORAGE:
        victim = db.execute("SELECT id, artifact_bytes FROM analysis_jobs WHERE status='complete' AND id<>? ORDER BY completed_at, id LIMIT 1", (protect_id,)).fetchone()
        if not victim:
            return False
        (SOURCE_DIR / f"{victim['id']}.source").unlink(missing_ok=True)
        (SOURCE_DIR / f"{victim['id']}.result.json").unlink(missing_ok=True)
        db.execute("DELETE FROM analysis_jobs WHERE id=?", (victim["id"],))
        db.commit()
        total -= victim["artifact_bytes"]
    return True


def chunk_text(tokenizer: Any, passage: str, max_tokens: int = 480) -> list[str]:
    try:
        encoded = tokenizer(passage, add_special_tokens=True, truncation=False, return_offsets_mapping=True)
        offsets = [offset for offset in encoded["offset_mapping"] if offset[1] > offset[0]]
    except (NotImplementedError, ValueError, TypeError, KeyError):
        return [passage[index:index + 500] for index in range(0, len(passage), 500)]
    if len(offsets) <= max_tokens:
        return [passage]
    output: list[str] = []
    start_token = 0
    cursor_char = 0
    while start_token < len(offsets):
        end_token = min(start_token + max_tokens, len(offsets))
        end_char = offsets[end_token - 1][1]
        part = passage[cursor_char:end_char]
        if part.strip():
            output.append(part)
        cursor_char = end_char
        start_token = end_token
    if cursor_char < len(passage) and output:
        output[-1] += passage[cursor_char:]
    return output


def load_models() -> tuple[Any, Any, Any, Any, Any]:
    import torch
    from transformers import AutoModelForSequenceClassification, AutoModelForSeq2SeqLM, AutoTokenizer

    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    local_only = os.environ.get("HF_HUB_OFFLINE", "0") == "1"
    fin_tokenizer = AutoTokenizer.from_pretrained(FINBERT_ID, cache_dir=MODEL_CACHE, local_files_only=local_only)
    classifier = AutoModelForSequenceClassification.from_pretrained(FINBERT_ID, cache_dir=MODEL_CACHE, local_files_only=local_only)
    classifier.eval()
    return torch, fin_tokenizer, classifier, None, None


def ensure_translation(torch: Any, translator: Any, tokenizer: Any) -> tuple[Any, Any]:
    if translator is not None:
        return translator, tokenizer
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    local_only = os.environ.get("HF_HUB_OFFLINE", "0") == "1"
    tokenizer = AutoTokenizer.from_pretrained(TRANSLATION_ID, cache_dir=MODEL_CACHE, local_files_only=local_only)
    translator = AutoModelForSeq2SeqLM.from_pretrained(TRANSLATION_ID, cache_dir=MODEL_CACHE, local_files_only=local_only)
    translator.eval()
    return translator, tokenizer


def translate_text(torch: Any, tokenizer: Any, model: Any, text: str) -> str:
    source = tokenizer(text, return_tensors="pt", truncation=False)
    if source["input_ids"].shape[-1] > 512:
        raise Unavailable("A German passage exceeded the translation token limit.")
    with torch.inference_mode():
        output = model.generate(**source, max_new_tokens=512, num_beams=2)
    if output.shape[-1] >= 512 and output[0, -1].item() != tokenizer.eos_token_id:
        raise Unavailable("A German translation exceeded the output limit.")
    translated = tokenizer.decode(output[0], skip_special_tokens=True)
    if not translated.strip():
        raise Unavailable("The German passage could not be translated.")
    return translated


def classify(torch: Any, tokenizer: Any, model: Any, text: str) -> dict[str, Any]:
    labels = ["positive", "negative", "neutral"]
    encoded = tokenizer(text, return_tensors="pt", truncation=False)
    if encoded["input_ids"].shape[-1] > 512:
        raise Unavailable("A sentiment passage exceeded the model token limit.")
    with torch.inference_mode():
        logits = model(**encoded).logits[0]
        scores = torch.softmax(logits, dim=-1).tolist()
    pairs = {labels[index]: round(float(scores[index]), 6) for index in range(min(len(scores), len(labels)))}
    return {"label": max(pairs, key=pairs.get), "scores": pairs}


def recover_interrupted(db: sqlite3.Connection) -> None:
    db.execute("UPDATE analysis_jobs SET status='queued', error='', updated_at=? WHERE status IN ('fetching','extracting','translating','classifying')",
               (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),))
    db.commit()


def model_revision(model: Any, model_id: str) -> str:
    revision = getattr(model.config, "_commit_hash", None)
    if revision:
        return str(revision)
    try:
        return str(json.loads((MODEL_CACHE / "model-revisions.json").read_text(encoding="utf-8"))[model_id])
    except (OSError, KeyError, ValueError):
        return "resolved-at-runtime"


def process(db: sqlite3.Connection, job: sqlite3.Row, models: list[Any]) -> None:
    job_id = job["id"]
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    source_tmp = TEMP_DIR / f"{job_id}.{uuid.uuid4().hex}.source"
    result_tmp = TEMP_DIR / f"{job_id}.{uuid.uuid4().hex}.json"
    source_path = SOURCE_DIR / f"{job_id}.source"
    result_path = SOURCE_DIR / f"{job_id}.result.json"
    try:
        original, text, document_urls = filing_text(job)
        needs_translation = job["market"] == "DE" and german_publication(original).get("language") != "en"
        source_tmp.write_bytes(original)
        db.execute("UPDATE analysis_jobs SET status='extracting', updated_at=? WHERE id=?", (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), job_id))
        db.commit()
        raw_passages = paragraphs(text)
        torch, fin_tokenizer, classifier, _, _ = models
        results = []
        for index, paragraph in enumerate(raw_passages):
            if needs_translation and models[3] is None:
                db.execute("UPDATE analysis_jobs SET status='translating', updated_at=? WHERE id=?", (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), job_id))
                db.commit()
                models[3], models[4] = ensure_translation(torch, models[3], models[4])
            splitter = models[4] if needs_translation else fin_tokenizer
            for part in chunk_text(splitter, paragraph, 448 if needs_translation else 480):
                translation = None
                sentiment_text = part
                if needs_translation:
                    db.execute("UPDATE analysis_jobs SET status='translating', updated_at=? WHERE id=?", (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), job_id))
                    db.commit()
                    translation = translate_text(torch, models[4], models[3], part)
                    sentiment_parts = chunk_text(fin_tokenizer, translation)
                else:
                    sentiment_parts = [part]
                db.execute("UPDATE analysis_jobs SET status='classifying', updated_at=? WHERE id=?", (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), job_id))
                db.commit()
                for sentiment_text in sentiment_parts:
                    results.append({"index": index, "original": part,
                                    "translation": translation if len(sentiment_parts) == 1 else sentiment_text if translation else None,
                                    "sentiment": classify(torch, fin_tokenizer, classifier, sentiment_text)})
        payload = {
            "market": job["market"], "title": job["title"],
            "source": {"url": job["filing_url"], "documents": document_urls, "cik": job["cik"], "accession": job["accession"], "formType": job["form_type"]},
            "model": FINBERT_ID,
            "model_revision": model_revision(classifier, FINBERT_ID), "translation_model": TRANSLATION_ID if needs_translation else None,
            "translation_revision": model_revision(models[3], TRANSLATION_ID) if needs_translation else None,
            "sentiment_kind": "financial sentiment; not financial bias", "passages": results,
            "coverage": {"extracted_characters": len(text), "passages": len(results), "complete_extraction": True}
        }
        result_tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        artifact_bytes = source_tmp.stat().st_size + result_tmp.stat().st_size
        if not prune_for(db, artifact_bytes, job_id):
            raise Unavailable("The 25 GiB analysis storage limit is full.")
        os.replace(source_tmp, source_path)
        os.replace(result_tmp, result_path)
        set_status(db, job_id, "complete", result_path=result_path.name, artifact_bytes=artifact_bytes)
    finally:
        source_tmp.unlink(missing_ok=True)
        result_tmp.unlink(missing_ok=True)


def run() -> None:
    import torch
    if hasattr(torch.backends, "mkldnn"):
        torch.backends.mkldnn.enabled = True
    db = open_db()
    # An interrupted model call is safe to repeat because outputs publish atomically.
    recover_interrupted(db)
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    retained = {row[0] for row in db.execute("SELECT id FROM analysis_jobs WHERE status='complete'").fetchall()}
    for path in SOURCE_DIR.iterdir():
        if path.name.endswith('.source') or path.name.endswith('.result.json'):
            if path.name.split('.', 1)[0] not in retained:
                path.unlink(missing_ok=True)
        elif path.is_file():
            path.unlink(missing_ok=True)
    for path in TEMP_DIR.iterdir():
        if path.is_file():
            path.unlink(missing_ok=True)
    models = list(load_models())
    while True:
        job = claim(db)
        if not job:
            time.sleep(2)
            continue
        try:
            process(db, job, models)
        except Unavailable as error:
            (SOURCE_DIR / f"{job['id']}.source").unlink(missing_ok=True)
            (SOURCE_DIR / f"{job['id']}.result.json").unlink(missing_ok=True)
            set_status(db, job["id"], "unavailable", error=str(error)[:300])
        except Exception as error:
            (SOURCE_DIR / f"{job['id']}.source").unlink(missing_ok=True)
            (SOURCE_DIR / f"{job['id']}.result.json").unlink(missing_ok=True)
            stage = db.execute("SELECT status FROM analysis_jobs WHERE id=?", (job["id"],)).fetchone()[0]
            set_status(db, job["id"], "failed", error=f"Local analysis failed during {stage} ({type(error).__name__}). See worker logs for details.")
            print(f"Analysis job {job['id']} failed during {stage}.", file=sys.stderr, flush=True)
            traceback.print_exc()


if __name__ == "__main__":
    run()
