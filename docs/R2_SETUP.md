# Cài đặt Cloudflare R2 cho ảnh

R2 miễn phí: 10GB lưu trữ, 1 triệu thao tác ghi + 10 triệu thao tác đọc mỗi tháng, băng thông tải ra không tính tiền.
Cloudflare có thể yêu cầu thêm thẻ thanh toán để bật R2; chỉ bị tính tiền khi vượt hạn mức free.

## 1. Tạo bucket
1. Vào https://dash.cloudflare.com → **R2 Object Storage** → bật R2.
2. **Create bucket** → tên ví dụ `truyen-images`.
3. Vào bucket → **Settings** → **Public Development URL** → **Enable**. Copy địa chỉ dạng `https://pub-xxxx.r2.dev` (đây là `R2_PUBLIC_URL`).
4. Cũng ở **Settings** → **CORS Policy** → **Add**, dán:
```json
[
  {
    "AllowedOrigins": ["https://truyen-psi.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```
(CORS cần để trình duyệt admin upload ảnh thẳng lên R2.)

## 2. Tạo khóa API
R2 → **Manage API Tokens** → **Create API token** → quyền **Object Read & Write**, chỉ áp cho bucket vừa tạo.
Lưu lại: Access Key ID, Secret Access Key, và Account ID (hiện ở trang R2).

## 3. Điền biến môi trường
Điền vào file `.env` (máy bạn) **và** Vercel → Project → Settings → Environment Variables:
```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=truyen-images
R2_PUBLIC_URL=https://pub-xxxx.r2.dev
```
Không dán khóa vào chat hay commit lên GitHub.

## 4. Chuyển ảnh cũ
```bash
node scripts/migrate_images_to_r2.js            # báo cáo
node scripts/migrate_images_to_r2.js --copy     # copy ảnh sang R2
node scripts/migrate_images_to_r2.js --rewrite  # đổi link trong DB (sau khi mở thử vài ảnh trên R2)
```
Script cần `DATABASE_URL` (chuỗi kết nối Postgres) trong môi trường.
Sau khi chắc chắn mọi ảnh mở được từ R2, mới xóa ảnh trên Supabase Storage (tùy chọn, để giải phóng dung lượng).

Khi chưa điền `R2_*`, web vẫn tự dùng Supabase Storage như cũ, và nút upload ảnh trong trang admin sẽ báo "Chưa cấu hình R2".
