const { Client } = require('pg');
const cs = 'postgresql://postgres.hdfwyfdrgkueatxkxuky:Yugiki4910%40@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';

async function main() {
  const client = new Client({ connectionString: cs });
  await client.connect();

  console.log('--- BẮT ĐẦU CẬP NHẬT TRUYỆN ĐIỆN THOẠI THẦN KỲ Ở TU CHÂN GIỚI ---');

  try {
    await client.query('BEGIN');

    // 1. Sửa Chương 57: Thêm câu mở đầu trước cảnh nhập học
    console.log('1. Sửa Chương 57...');
    const ch57Res = await client.query('SELECT content FROM chapters WHERE story_id = 7 AND chapter_number = 57');
    let content57 = ch57Res.rows[0].content;
    if (!content57.includes('Vài ngày sau, Kiệt cuối cùng cũng đến được học viện')) {
      content57 = '<p>Vài ngày sau, Kiệt cuối cùng cũng đến được học viện...</p>' + content57;
      await client.query('UPDATE chapters SET content = $1 WHERE story_id = 7 AND chapter_number = 57', [content57]);
      console.log('✅ Đã sửa Chương 57.');
    } else {
      console.log('Chương 57 đã có câu mở đầu.');
    }

    // 2. Sửa Chương 59: Thống nhất thời gian khảo sát thành 7 ngày 7 đêm
    console.log('2. Sửa Chương 59...');
    const ch59Res = await client.query('SELECT content FROM chapters WHERE story_id = 7 AND chapter_number = 59');
    let content59 = ch59Res.rows[0].content;
    const old59 = '<p>— Thời gian khảo sát...</p><p>— Ba ngày ba đêm.</p><p>— Sau khi kết thúc, năm mươi người có điểm số cao nhất sẽ được vào học viện!</p>';
    const new59 = '<p>— Thời gian khảo sát...</p><p>— Bảy ngày bảy đêm!</p><p>— Trong bảy ngày này, các ngươi được tự do săn yêu thú, thu thập tín vật và tranh đoạt điểm số.</p><p>— Sau khi thời hạn kết thúc, năm mươi người có điểm số cao nhất sẽ tiến vào Bảng Xếp Hạng Tân Sinh!</p>';
    if (content59.includes('Ba ngày ba đêm')) {
      content59 = content59.replace(old59, new59);
      await client.query('UPDATE chapters SET content = $1 WHERE story_id = 7 AND chapter_number = 59', [content59]);
      console.log('✅ Đã sửa Chương 59 thành 7 ngày 7 đêm.');
    } else {
      console.log('Chương 59 đã được sửa trước đó.');
    }

    // 3. Sửa Chương 63: Thay lời mở đầu lặp về khu rừng bằng diễn biến mới
    console.log('3. Sửa Chương 63...');
    const ch63Res = await client.query('SELECT content FROM chapters WHERE story_id = 7 AND chapter_number = 63');
    let content63 = ch63Res.rows[0].content;
    const old63 = '<p>— Rậm ơi là rậm! Lắm muỗi thế này!</p><p>Kiệt vừa bước sâu vào khu rừng, vừa ngáp dài một cái.</p><p>Con Phong Linh Điểu thấy có người chặn đường liền đổi hướng bỏ chạy.</p>';
    const new63 = '<p>Vừa nhận lời của Lê Bảo, Kiệt lập tức vận chuyển linh lực dậm mạnh chân, thân hình như mũi tên lao vút lên không trung chắn ngay trước đường bay của con Phong Linh Điểu.</p><p>Bị chặn đường đột ngột, con súc sinh rít lên một tiếng chói tai rồi vỗ cánh đảo hướng tháo chạy vào sâu trong hẻm núi.</p>';
    if (content63.includes('Rậm ơi là rậm')) {
      content63 = content63.replace(old63, new63);
      await client.query('UPDATE chapters SET content = $1 WHERE story_id = 7 AND chapter_number = 63', [content63]);
      console.log('✅ Đã sửa mở đầu Chương 63.');
    } else {
      console.log('Chương 63 đã được sửa trước đó.');
    }

    // 4. Sửa Chương 70: Xóa một trong hai cụm "Ngày hôm sau" / "Sáng hôm sau"
    console.log('4. Sửa Chương 70...');
    const ch70Res = await client.query('SELECT content FROM chapters WHERE story_id = 7 AND chapter_number = 70');
    let content70 = ch70Res.rows[0].content;
    if (content70.includes('<p>Ngày hôm sau...</p><p>Sáng hôm sau.</p>')) {
      content70 = content70.replace('<p>Ngày hôm sau...</p><p>Sáng hôm sau.</p>', '<p>Sáng hôm sau.</p>');
      await client.query('UPDATE chapters SET content = $1 WHERE story_id = 7 AND chapter_number = 70', [content70]);
      console.log('✅ Đã sửa Chương 70.');
    } else {
      console.log('Chương 70 đã không còn lặp từ.');
    }

    // 5. Tách Chương 71 thành 3 chương và đẩy STT các chương sau (72..77 -> 74..79)
    console.log('5. Tách Chương 71 thành 3 chương và đẩy STT các chương sau...');
    const ch71Res = await client.query('SELECT id, content FROM chapters WHERE story_id = 7 AND chapter_number = 71');
    const text71 = ch71Res.rows[0].content;
    const ch71Id = ch71Res.rows[0].id;

    const splitMarker1 = '<p>Chiến thuyền nhanh chóng quay đầu.</p>';
    const splitMarker2 = '<p>Bầu không khí nặng nề trên thương thuyền cuối cùng cũng dịu đi đôi chút.</p>';

    const idx1 = text71.indexOf(splitMarker1);
    const idx2 = text71.indexOf(splitMarker2);

    if (idx1 === -1 || idx2 === -1) {
      throw new Error('Không tìm thấy điểm tách chương 71!');
    }

    const part1 = text71.slice(0, idx1 + splitMarker1.length);
    const part2 = text71.slice(idx1 + splitMarker1.length, idx2 + splitMarker2.length).trim();
    const part3 = text71.slice(idx2 + splitMarker2.length).trim();

    // Bước 5.1: Đẩy các chương từ 72 trở đi lên +1000 tạm thời để tránh đụng UNIQUE constraint
    await client.query('UPDATE chapters SET chapter_number = chapter_number + 1000 WHERE story_id = 7 AND chapter_number >= 72');

    // Bước 5.2: Đưa về đúng số mới (+2) và cập nhật tiêu đề chương
    const titleUpdates = [
      { oldNum: 1072, newNum: 74, newTitle: 'Chương 74: Bắt Sứa Điện' },
      { oldNum: 1073, newNum: 75, newTitle: 'Chương 75: Cô Giáo Phương Hồng' },
      { oldNum: 1074, newNum: 76, newTitle: 'Chương 76: Sư Phụ Giải Vây' },
      { oldNum: 1075, newNum: 77, newTitle: 'Chương 77: Đêm Xuân Thuộc Về Nhau' },
      { oldNum: 1076, newNum: 78, newTitle: 'Chương 78: Bình yên' },
      { oldNum: 1077, newNum: 79, newTitle: 'Chương 79: Chiến Tinh Bảng' }
    ];

    for (const u of titleUpdates) {
      await client.query(
        'UPDATE chapters SET chapter_number = $1, title = $2 WHERE story_id = 7 AND chapter_number = $3',
        [u.newNum, u.newTitle, u.oldNum]
      );
    }
    console.log('✅ Đã đẩy STT các chương 72-77 cũ thành 74-79 mới.');

    // Bước 5.3: Cập nhật Chương 71 (giữ ID cũ, cập nhật part1)
    await client.query(
      'UPDATE chapters SET title = $1, content = $2 WHERE id = $3',
      ['Chương 71: Lên Thuyền Biển Tây', part1, ch71Id]
    );
    console.log('✅ Đã cập nhật Chương 71 (Phần 1/3).');

    // Bước 5.4: Tạo mới Chương 72 (part2) và Chương 73 (part3)
    await client.query(
      'INSERT INTO chapters (story_id, chapter_number, title, content, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [7, 72, 'Chương 72: Truy Kích Tàu Hải Tặc', part2]
    );
    console.log('✅ Đã tạo mới Chương 72 (Phần 2/3).');

    await client.query(
      'INSERT INTO chapters (story_id, chapter_number, title, content, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [7, 73, 'Chương 73: Bão Tố Biển Tây', part3]
    );
    console.log('✅ Đã tạo mới Chương 73 (Phần 3/3).');

    // 6. Sửa Chương 78 mới (Chương 76 cũ): Tách lời chúc Giáng sinh thành ghi chú tác giả
    console.log('6. Sửa Chương 78 mới (tách lời chúc Giáng sinh)...');
    const ch78Res = await client.query('SELECT content FROM chapters WHERE story_id = 7 AND chapter_number = 78');
    let content78 = ch78Res.rows[0].content;
    const oldNotePattern = /<p>\.\.\.<\/p>\s*<p>Giáng sinh vui vẻ nha anh em<\/p>\s*<p>Mai là một ngày quan trọng của em nên tự chúc em mai một ngày tốt lành, may mắn và thành công<\/p>/gi;
    const formattedNote = `<div class="author-note" style="margin-top: 2rem; padding: 1rem; border-top: 1px dashed rgba(255,255,255,0.2); color: #94a3b8; font-style: italic; font-size: 0.9rem;">
  <strong>📌 Lời nhắn tác giả:</strong><br>
  Giáng sinh vui vẻ nha anh em! Mai là một ngày quan trọng của mình nên tự chúc mình một ngày tốt lành, may mắn và thành công!
</div>`;
    content78 = content78.replace(oldNotePattern, formattedNote);
    await client.query('UPDATE chapters SET content = $1 WHERE story_id = 7 AND chapter_number = 78', [content78]);
    console.log('✅ Đã tách ghi chú tác giả ở Chương 78.');

    // 7. Sửa Chương 79 mới (Chương 77 cũ): Áp dụng Phương án A (cuộc gặp mới tại ký túc xá)
    console.log('7. Sửa Chương 79 mới theo Phương án A...');
    const ch79Res = await client.query('SELECT content FROM chapters WHERE story_id = 7 AND chapter_number = 79');
    let content79 = ch79Res.rows[0].content;

    // Tìm đoạn bắt đầu của danh sách Chiến Tinh Bảng
    const ctbIndex = content79.indexOf('Chiến Tinh Bảng');
    if (ctbIndex === -1) {
      throw new Error('Không tìm thấy từ khóa Chiến Tinh Bảng trong Chương 79!');
    }
    const ctbContent = content79.slice(ctbIndex);

    const newCh79Intro = `<p>Đêm hôm sau.</p>
<p>Trong ký túc xá, Kiệt đang ngồi xếp bằng điều tức. Việc luyện hóa dị mộc vẫn chưa có tiến triển đáng kể.</p>
<p>Cốc! Cốc! Cốc!</p>
<p>— Ai đấy? Giờ này rồi còn tìm người ta?</p>
<p>— Là ta.</p>
<p>Nghe giọng nói quen thuộc ngoài cửa, Kiệt lập tức mở mắt.</p>
<p>— Cô Hồng?</p>
<p>Phương Hồng bước vào, trên tay cầm một quyển sổ bìa đen đã cũ.</p>
<p>— Hôm trước ta nghe em nói muốn biết những cường giả thực sự của Giới Tinh. Hôm nay tiện đường nên mang thứ này đến.</p>
<p>— Thứ gì mà bí mật thế cô?</p>
<p>— Chiến Tinh Bảng.</p>
<p>Kiệt hơi ngạc nhiên.</p>
<p>— Bảng xếp hạng? Lại còn có thứ này nữa à?</p>
<p>Phương Hồng mỉm cười, đặt quyển sổ lên bàn.</p>
<p>— Những người mà em từng gặp, kể cả những kẻ được gọi là thiên tài, chưa chắc đã đủ tư cách xuất hiện trong đây.</p>
<p>Kiệt lập tức ngồi thẳng dậy.</p>
<p>— Ghê vậy?</p>
<p>— Muốn biết thì ngồi xuống. Ta sẽ giải thích cho em.</p>
<p>Kiệt cầm lấy quyển sổ bìa đen, tò mò hỏi:</p>
<p>— Nhưng nếu đám này nổi danh như vậy, sao em thấy không ít người ngoài kia lại chẳng biết gì về chúng?</p>
<p>— Đó là bởi những người em từng gặp đều thuộc tầng lớp dưới thôi. Các cao tầng của VTV, Công Lý Điện cùng những tổ chức lớn kia cố tình phong tỏa tin tức, chỉ cho các Trung Thế Lực trở lên được biết.</p>
<p>— Ơ? Sao lại thế hả cô?</p>
<p>— Có lẽ họ nghĩ người tầng lớp thấp biết cũng chẳng có ý nghĩa gì, ngược lại đôi khi còn khiến họ nhụt chí mất động lực tu luyện.</p>
<p>— Ra là vậy...</p>
<p>Kiệt không hỏi thêm nữa, hồi hộp mở từng trang sổ và chăm chú đọc.</p>
<p><strong>`;

    const finalCh79 = newCh79Intro + ctbContent;
    await client.query('UPDATE chapters SET content = $1 WHERE story_id = 7 AND chapter_number = 79', [finalCh79]);
    console.log('✅ Đã sửa mở đầu Chương 79 theo Phương án A hoàn chỉnh.');

    await client.query('COMMIT');
    console.log('\n🎉 TOÀN BỘ CÁC BƯỚC ĐÃ ĐƯỢC CẬP NHẬT THÀNH CÔNG VÀO DATABASE!');

    // Kiểm tra tổng số chương hiện tại
    const countRes = await client.query('SELECT COUNT(*) AS total FROM chapters WHERE story_id = 7');
    console.log(`Tổng số chương hiện tại của truyện: ${countRes.rows[0].total} chương (từ 1 đến 79).`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ LỖI VÀ ĐÃ ROLLBACK:', err);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch(console.error);
