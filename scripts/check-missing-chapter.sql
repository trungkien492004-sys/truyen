-- Chạy trong Supabase Dashboard > SQL Editor để tìm chương nào đang bị thiếu (gap)
-- trong dãy số chương liên tục của 1 truyện.
-- Thay 15 bằng đúng story_id của "Con Đường Bá Chủ" nếu khác.

WITH nums AS (
  SELECT chapter_number,
         LEAD(chapter_number) OVER (ORDER BY chapter_number) AS next_number
  FROM chapters
  WHERE story_id = 15
)
SELECT chapter_number AS sau_chuong_nay, next_number AS toi_chuong_nay, (next_number - chapter_number - 1) AS so_chuong_bi_thieu
FROM nums
WHERE next_number - chapter_number > 1
ORDER BY chapter_number;

-- Đồng thời kiểm tra có chương nào bị trùng số không (nguyên nhân gây dedupe nhầm khi upload)
SELECT chapter_number, COUNT(*) AS so_lan_trung
FROM chapters
WHERE story_id = 15
GROUP BY chapter_number
HAVING COUNT(*) > 1
ORDER BY chapter_number;
