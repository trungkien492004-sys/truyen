const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const hasValidSupabaseUrl = typeof supabaseUrl === 'string' && supabaseUrl.trim() && !supabaseUrl.includes('your_supabase_url');
const hasValidSupabaseKey = typeof supabaseKey === 'string' && supabaseKey.trim() && !supabaseKey.includes('your_supabase_anon');

if (!hasValidSupabaseUrl || !hasValidSupabaseKey) {
    console.warn('CẢNH BÁO: Cấu hình Supabase (SUPABASE_URL hoặc SUPABASE_KEY) chưa được điền chính xác trong file .env');
}

if (!hasValidSupabaseUrl || !hasValidSupabaseKey) {
    throw new Error('Thiếu cấu hình Supabase. Hãy kiểm tra SUPABASE_URL và SUPABASE_KEY trong file .env');
}

// Khởi tạo Supabase Client
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
