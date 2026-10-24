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
