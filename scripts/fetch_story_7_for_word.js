const fs = require('fs');
const supabase = require('../config/supabase');

async function main() {
  const { data: story, error: storyErr } = await supabase
    .from('stories')
    .select('*')
    .eq('id', 7)
    .single();

  if (storyErr) throw storyErr;

  let chapters = [];
  let page = 0;
  const limit = 1000;
  while (true) {
    const { data: batch, error: batchErr } = await supabase
      .from('chapters')
      .select('chapter_number, title, content')
      .eq('story_id', 7)
      .order('chapter_number', { ascending: true })
      .range(page * limit, (page + 1) * limit - 1);

    if (batchErr) throw batchErr;
    if (!batch || batch.length === 0) break;
    chapters = chapters.concat(batch);
    if (batch.length < limit) break;
    page++;
  }

  console.log(`Fetched "${story.title}" with ${chapters.length} chapters.`);
  fs.writeFileSync('temp_story_7.json', JSON.stringify({ story, chapters }), 'utf8');
  console.log('Saved to temp_story_7.json');
}

main().catch(console.error);
