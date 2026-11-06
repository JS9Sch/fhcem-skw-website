-- 詩歌庫 (sheet-music library). Same database as 團契點名 (binding ATT_DB).
-- The PDFs live in the church's Google Drive (網站／詩歌庫／<歌名>／…); D1 keeps the song
-- details and which Drive file is the current score, an old version (舊版) or deleted (已刪除).
-- The Google refresh token, when connected from the admin page, is settings.google_drive
-- (AES-GCM sealed, key derived from the Worker secret).

CREATE TABLE songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_zh TEXT NOT NULL DEFAULT '',  -- 中文歌名 (Drive folder name); '' when the song has only an English title
  title_en TEXT NOT NULL DEFAULT '',
  copyright TEXT NOT NULL DEFAULT '', -- 版權機構
  copyright_guess INTEGER NOT NULL DEFAULT 0 CHECK (copyright_guess IN (0, 1)), -- 1 = 「估計」
  note TEXT NOT NULL DEFAULT '',
  folder_id TEXT,                     -- the song's Drive folder, made on first upload
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_role TEXT NOT NULL,
  CHECK (title_zh <> '' OR title_en <> '')
);
CREATE INDEX songs_by_created ON songs(state, created_at);

CREATE TABLE song_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id),
  kind TEXT NOT NULL CHECK (kind IN ('score', 'drum')), -- 樂譜 / 鼓譜
  song_key TEXT NOT NULL DEFAULT '',  -- 調, e.g. 'G', 'B♭'; '' = not given
  drive_id TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  photos INTEGER NOT NULL DEFAULT 0,  -- made from this many phone photos (originals in 原檔/)
  state TEXT NOT NULL DEFAULT 'current' CHECK (state IN ('current', 'old', 'deleted')),
  created_at TEXT NOT NULL,
  created_role TEXT NOT NULL,
  changed_at TEXT,                    -- when it became 舊版 or was deleted
  changed_role TEXT
);
-- One shown file per song, kind and key; uploading again moves the old one to 舊版.
CREATE UNIQUE INDEX song_files_current ON song_files(song_id, kind, song_key) WHERE state = 'current';
CREATE INDEX song_files_by_song ON song_files(song_id, state);

-- Phone photos kept as the 原檔 of a PDF made from them.
CREATE TABLE song_originals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES song_files(id),
  drive_id TEXT NOT NULL UNIQUE,
  seq INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- Drive folder ids by path (網站/詩歌庫/…), so each upload does not search Drive again.
CREATE TABLE drive_folders (
  path TEXT PRIMARY KEY,
  drive_id TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES ('google_drive', NULL);
