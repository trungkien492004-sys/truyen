-- Hướng dẫn: Copy toàn bộ file này dán vào "SQL Editor" trên Supabase và bấm "Run".
-- Bảng này lưu lại mỗi lần một độc giả lên rank (đột phá cảnh giới),
-- để trang chủ có thể hiện banner công khai cho MỌI người xem trong ngày hôm đó.

CREATE TABLE IF NOT EXISTS rank_up_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_rank TEXT,
  to_rank TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rank_up_events_created_at ON rank_up_events(created_at DESC);

ALTER TABLE rank_up_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_rank_up_events" ON rank_up_events
  FOR ALL USING (true) WITH CHECK (true);
