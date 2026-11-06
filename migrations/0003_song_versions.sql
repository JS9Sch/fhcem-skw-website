-- 詩歌庫: 版本 and 標籤 (2026-11-07).
-- A song can have several files of the same 類型 and 調 as different 版本 (簡譜, 鋼琴, 前奏,
-- 和弦, 和音, 修訂版, Alto, 粵語版…). '' is the 標準 version, so existing files keep their meaning.
ALTER TABLE song_files ADD COLUMN version TEXT NOT NULL DEFAULT '';
-- 標籤 on a song, a JSON array of strings, e.g. ["只有鼓譜"] or ["其他"].
ALTER TABLE songs ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
-- One shown file per song, kind, key and version; uploading the same version again moves
-- the old one to 舊版, a different version sits beside it.
DROP INDEX song_files_current;
CREATE UNIQUE INDEX song_files_current ON song_files(song_id, kind, song_key, version) WHERE state = 'current';
