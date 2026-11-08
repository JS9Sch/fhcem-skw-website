-- 網站更新 (2026-11-08): an internal log of changes to the website, shown to signed-in 會友
-- in 肢體專區. Only the 網站管理員 writes; deleting keeps the row (state 'deleted').
CREATE TABLE site_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  kind TEXT NOT NULL CHECK (kind IN ('new', 'improve', 'fix', 'content', 'notice')),
  area TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 1200),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'deleted')),
  created_at TEXT NOT NULL,
  created_role TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_role TEXT NOT NULL
);
CREATE INDEX site_updates_day ON site_updates(state, day DESC, id DESC);
