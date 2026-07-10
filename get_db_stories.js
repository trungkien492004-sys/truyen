const supabase = require('./config/supabase');

async function run() {
  const { data, error } = await supabase.from('stories').select('id, title');
  if (error) console.error(error);
  else console.log(data);
}
run();
