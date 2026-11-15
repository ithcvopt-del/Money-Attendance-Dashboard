-- ตาราง entries แทนแผ่นงาน "Data" ใน Google Sheet
CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,  -- แทน rowNumber ของชีท
  date       TEXT    NOT NULL,                   -- yyyy-mm-dd (ค.ศ.)
  name       TEXT    NOT NULL,
  leave_type TEXT    NOT NULL,
  shift      TEXT    NOT NULL,
  ot         REAL    NOT NULL DEFAULT 0,
  picture    TEXT    NOT NULL DEFAULT '',        -- URL หรือ path ในรีโป (pictures/...)
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_entries_name_date ON entries(name, date);
