const supabase = require('./config/supabase');

async function main() {
  const { data: users, error } = await supabase.from('users').select('*');
  if (error) {
    console.error("Lỗi:", error);
  } else {
    console.log("Danh sách Users:", users);
  }
}
main();
