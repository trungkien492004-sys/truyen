// Lưu trữ ảnh: ưu tiên Cloudflare R2 (miễn phí băng thông ra, 10GB free).
// Nếu CHƯA cấu hình R2_* trong .env thì tạm dùng Supabase Storage như cũ để web không gãy.
//
// Biến môi trường cần cho R2:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
//   (R2_PUBLIC_URL là địa chỉ công khai của bucket, ví dụ https://pub-xxxx.r2.dev, không có dấu / ở cuối)
const path = require('path');
const crypto = require('crypto');
const supabase = require('../config/supabase');

const R2_READY = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL']
  .every(k => process.env[k] && process.env[k].trim());

let _client;
function r2Client() {
  if (!_client) {
    const { S3Client } = require('@aws-sdk/client-s3');
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
    });
  }
  return _client;
}

const publicUrlFor = key => `${process.env.R2_PUBLIC_URL.replace(/\/+$/, '')}/${key}`;

function makeKey(originalName = '', prefix = '') {
  const ext = path.extname(originalName).toLowerCase() || '.bin';
  return `${prefix}${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
}

/** Upload một buffer, trả về URL công khai. */
async function uploadBuffer(buffer, { contentType = 'application/octet-stream', originalName = '', prefix = '', key } = {}) {
  const fileKey = key || makeKey(originalName, prefix);
  if (R2_READY) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await r2Client().send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET, Key: fileKey, Body: buffer, ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable'
    }));
    return publicUrlFor(fileKey);
  }
  // Dự phòng: Supabase Storage
  const { error } = await supabase.storage.from('uploads').upload(fileKey, buffer, { contentType, upsert: true, cacheControl: '31536000' });
  if (error) throw error;
  return supabase.storage.from('uploads').getPublicUrl(fileKey).data.publicUrl;
}

/** Upload file từ multer (memoryStorage). */
function uploadFile(file, opts = {}) {
  if (!file) return null;
  return uploadBuffer(file.buffer, { contentType: file.mimetype, originalName: file.originalname, ...opts });
}

/** Tạo link PUT có chữ ký để trình duyệt (admin) upload thẳng lên R2, không qua Vercel (tránh giới hạn 4.5MB). */
async function presignUpload(contentType, ext = '.png', prefix = 'word-img-') {
  if (!R2_READY) return null;
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const key = makeKey(`x${ext}`, prefix);
  const uploadUrl = await getSignedUrl(r2Client(), new PutObjectCommand({
    Bucket: process.env.R2_BUCKET, Key: key, ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable'
  }), { expiresIn: 300 });
  return { uploadUrl, publicUrl: publicUrlFor(key), key };
}

module.exports = { R2_READY, uploadBuffer, uploadFile, presignUpload, r2Client, publicUrlFor };
