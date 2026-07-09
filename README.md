# 📖 Hướng Dẫn Cài Đặt Và Chạy Ứng Dụng Web Đọc Truyện (Node.js & Supabase)

Ứng dụng web đọc truyện cao cấp được xây dựng trên nền tảng **Node.js (Express)** kết hợp với **Supabase (PostgreSQL)** để lưu trữ cơ sở dữ liệu tốc độ cao, hỗ trợ phân loại thể loại, tìm kiếm truyện, bảng xếp hạng đọc nhiều nhất và hệ thống đăng nhập bằng Google OAuth.

---

## 🛠️ Hướng Dẫn Cài Đặt Chi Tiết

### Bước 1: Tải Các Thư Viện Phụ Thuộc (Dependencies)
Mở terminal tại thư mục dự án và chạy câu lệnh sau để tự động tải các gói npm cần thiết:
```bash
npm install
```

### Bước 2: Thiết Lập Cơ Sở Dữ Liệu Trên Supabase
1. Đăng nhập hoặc đăng ký tài khoản miễn phí tại [Supabase](https://supabase.com/).
2. Tạo một Project mới.
3. Khi Project được khởi tạo thành công, truy cập vào menu **SQL Editor** ở thanh menu bên trái.
4. Mở một query mới, copy toàn bộ nội dung trong tệp [schema.sql](file:///C:/Users/Kien/.gemini/antigravity/scratch/truyen/schema.sql) của dự án dán vào ô nhập liệu và nhấn **Run** để khởi tạo các bảng và dữ liệu mẫu.

### Bước 3: Cấu Hình Biến Môi Trường (.env)
Tạo file `.env` từ file mẫu `.env.example` hoặc mở tệp [.env](file:///C:/Users/Kien/.gemini/antigravity/scratch/truyen/.env) và thay đổi các thông số cấu hình:

1. **Supabase**:
   * Vào **Project Settings** -> **API** trên Supabase Dashboard để lấy:
     * `SUPABASE_URL` (URL kết nối)
     * `SUPABASE_KEY` (Lấy Anon key hoặc Service role key để ghi dữ liệu)
2. **Google OAuth**:
   * Truy cập [Google Cloud Console](https://console.cloud.google.com/).
   * Tạo một Project mới, thiết lập màn hình đồng ý OAuth (OAuth consent screen).
   * Vào **Credentials** -> **Create Credentials** -> **OAuth client ID** (Chọn Web Application).
   * Thêm Authorized Redirect URI: `http://localhost:3000/auth/google/callback`.
   * Lấy `Client ID` và `Client Secret` điền vào `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET`.
3. **Admin Email**:
   * Điền email Google cá nhân của bạn vào mục `ADMIN_EMAIL`. Khi bạn đăng nhập vào web bằng tài khoản này lần đầu tiên, hệ thống sẽ tự động cấp quyền Quản trị viên (Admin) cho tài khoản này.

---

## 🚀 Khởi Chạy Ứng Dụng

Mở terminal tại thư mục dự án và khởi chạy máy chủ:
```bash
node app.js
```
Truy cập ứng dụng tại địa chỉ trình duyệt: **`http://localhost:3000`**

---

## 📁 Cấu Trúc File & Thư Mục Chính
* `app.js`: Điểm khởi chạy ứng dụng chính.
* `schema.sql`: Mã nguồn SQL chạy trên Supabase.
* `config/`: Chứa file kết nối Supabase và cấu hình Passport xác thực Google.
* `routes/`: Chứa các file xử lý định tuyến (Độc giả, Quản trị, Xác thực).
* `views/`: Chứa các trang giao diện hiển thị (EJS).
* `public/`: Thư mục chứa tài nguyên tĩnh như CSS, JS client và các file ảnh upload từ độc giả.
