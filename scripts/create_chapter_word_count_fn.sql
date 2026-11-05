-- Hàm đếm chữ của chương ngay trong database (không tải nội dung về server).
-- Chạy trong Supabase → SQL Editor, hoặc: psql "$DATABASE_URL" -f scripts/create_chapter_word_count_fn.sql
CREATE OR REPLACE FUNCTION chapter_word_count(p_story_id int, p_chapter_number numeric)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_length(
    regexp_split_to_array(NULLIF(btrim(regexp_replace(content, '<[^>]*>', ' ', 'g')), ''), '\s+'), 1), 0)
  FROM chapters WHERE story_id = p_story_id AND chapter_number = p_chapter_number LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION chapter_word_count(int, numeric) TO anon, authenticated, service_role;
