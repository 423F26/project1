CREATE TABLE IF NOT EXISTS analysis_jobs (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  market TEXT NOT NULL CHECK (market IN ('US', 'DE')),
  filing_url TEXT NOT NULL,
  cik TEXT NOT NULL DEFAULT '',
  accession TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  form_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('queued','fetching','extracting','translating','classifying','complete','unavailable','failed')),
  error TEXT NOT NULL DEFAULT '',
  result_path TEXT NOT NULL DEFAULT '',
  artifact_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS analysis_jobs_created ON analysis_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS analysis_jobs_filing_url ON analysis_jobs(market, filing_url);
CREATE TABLE IF NOT EXISTS analysis_uploads (
  job_id TEXT PRIMARY KEY REFERENCES analysis_jobs(id),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en', 'de')),
  sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS companies (
 id TEXT PRIMARY KEY, market TEXT NOT NULL, identity TEXT NOT NULL, name TEXT NOT NULL, ticker TEXT NOT NULL DEFAULT '', UNIQUE(market,identity)
);
CREATE TABLE IF NOT EXISTS company_filings (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), source_key TEXT NOT NULL UNIQUE,
 market TEXT NOT NULL, url TEXT NOT NULL, cik TEXT NOT NULL DEFAULT '', accession TEXT NOT NULL DEFAULT '',
 title TEXT NOT NULL, form_type TEXT NOT NULL DEFAULT '', filed_at TEXT NOT NULL DEFAULT '', report_date TEXT NOT NULL DEFAULT '', source_description TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS company_filing_dates ON company_filings(company_id,filed_at DESC);
CREATE TABLE IF NOT EXISTS report_runs (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), primary_id TEXT NOT NULL, prior_id TEXT,
 filing_ids TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','complete','partial','failed','unavailable')),
 stage TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, completed_at TEXT NOT NULL DEFAULT '',
 payload TEXT, artifact_bytes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS company_assessments (company_id TEXT PRIMARY KEY REFERENCES companies(id), payload TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS library_documents (
 filing_id TEXT PRIMARY KEY REFERENCES company_filings(id), kind TEXT NOT NULL, source_path TEXT NOT NULL, anchors_path TEXT NOT NULL,
 provenance TEXT NOT NULL, artifact_bytes INTEGER NOT NULL, created_at TEXT NOT NULL
);
