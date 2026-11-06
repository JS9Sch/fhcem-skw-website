-- Attendance (團契點名) for 筲箕灣堂. Binding ATT_DB.
-- Members are stored by the short name used inside their group only:
-- no full names, phone numbers or birthdays. Codes are stored as PBKDF2 hashes.

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fellowship', 'headcount')),
  rule TEXT NOT NULL,                 -- JSON, e.g. {"weekday":5,"weeks":[2,4]}; weekday 0 = Sunday
  sort INTEGER NOT NULL,              -- row order in 《月訊》
  code_hash TEXT,
  code_salt TEXT,
  code_version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES groups(id),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX members_by_group ON members(group_id, status);

-- One row per regular meeting (group + original scheduled date); extra meetings
-- have no scheduled date and are identified by a client-made ref so a queued
-- (offline) save can be sent twice without creating two meetings.
CREATE TABLE meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES groups(id),
  scheduled_date TEXT,
  actual_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('regular', 'extra')),
  state TEXT NOT NULL CHECK (state IN ('held', 'cancelled')),
  new_friends INTEGER NOT NULL DEFAULT 0,
  other_guests INTEGER NOT NULL DEFAULT 0,
  headcount INTEGER,
  ref TEXT UNIQUE,
  updated_at TEXT NOT NULL,
  updated_role TEXT NOT NULL,
  UNIQUE (group_id, scheduled_date),
  CHECK ((kind = 'regular') = (scheduled_date IS NOT NULL))
);
CREATE INDEX meetings_by_date ON meetings(actual_date);

CREATE TABLE attendance (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  status TEXT NOT NULL CHECK (status IN ('present', 'leave', 'absent')),
  PRIMARY KEY (meeting_id, member_id)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- staff_code: JSON {salt, hash, version}; set by the website admin.
-- sheets_export: Google Sheets ID for a later export (not connected yet).
INSERT INTO settings (key, value) VALUES ('staff_code', NULL), ('sheets_export', NULL);

-- Times from the 2026-10-25 Sunday report. Order = 《月訊》 attendance table.
INSERT INTO groups (id, name, kind, rule, sort) VALUES
  ('sat-worship',   '週六崇拜',       'headcount',  '{"weekday":6}', 10),
  ('sun-worship',   '主日崇拜',       'headcount',  '{"weekday":0}', 20),
  ('kids-worship',  '幼兒崇拜',       'headcount',  '{"weekday":0}', 30),
  ('ss-children',   '主日學(兒童)',   'headcount',  '{"weekday":0}', 40),
  ('ss-youth-adult','主日學(少青成)', 'headcount',  '{"weekday":0}', 50),
  ('prayer',        '祈禱會',         'headcount',  '{"weekday":3}', 60),
  ('joshua',        '約書亞團',       'fellowship', '{"weekday":6}', 70),
  ('shu-o',         '樹 O 組',        'fellowship', '{"weekday":0}', 80),
  ('david',         '大衛團',         'fellowship', '{"weekday":0}', 90),
  ('paul',          '保羅團',         'fellowship', '{"weekday":6}', 100),
  ('esther',        '以斯帖團',       'fellowship', '{"weekday":6}', 110),
  ('joseph',        '約瑟團',         'fellowship', '{"weekday":5,"weeks":[2,4]}', 120),
  ('shiloh',        '示羅團',         'fellowship', '{"weekday":5,"weeks":[2]}', 130),
  ('bethel',        '伯特利小組',     'fellowship', '{"weekday":2}', 140),
  ('ashuli',        '亞書利團',       'fellowship', '[{"weekday":6,"weeks":[3]},{"weekday":6,"weeks":[1],"months":[2,4,6,8,10,12]}]', 150),
  ('canaan',        '迦南團',         'fellowship', '{"weekday":6,"weeks":[2]}', 160);
