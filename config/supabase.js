const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('your_supabase_url') || supabaseKey.includes('your_supabase_anon')) {
    console.warn('CẢNH BÁO: Cấu hình Supabase (SUPABASE_URL hoặc SUPABASE_KEY) chưa được điền chính xác trong file .env');
}

// Khởi tạo Supabase Client
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
