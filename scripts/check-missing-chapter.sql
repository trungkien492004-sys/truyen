const supabase = require('C:/Users/Kien/.gemini/antigravity/scratch/truyen/config/supabase');

async function run() {
  const { data: stories, error } = await supabase.from('stories').select('id, title');
  if (error) {
    console.error(error);
    return;
  }

  console.log('Story chapters check:');
  for (const story of stories) {
    const { data: chapters, error: chapErr } = await supabase
      .from('chapters')
      .select('chapter_number')
      .eq('story_id', story.id)
      .order('chapter_number', { ascending: true });

    if (chapErr) {
      console.error(chapErr);
      continue;
    }

    if (chapters.length === 0) {
      console.log(`- [ID: ${story.id}] "${story.title}": 0 chapters`);
      continue;
    }

    const min = chapters[0].chapter_number;
    const max = chapters[chapters.length - 1].chapter_number;
    const count = chapters.length;

    // Check if there are gaps
    let gaps = [];
    for (let i = 0; i < chapters.length - 1; i++) {
      const cur = chapters[i].chapter_number;
      const next = chapters[i + 1].chapter_number;
      if (next - cur > 1) {
        gaps.push(`${cur}->${next}`);
      }
    }

    console.log(`- [ID: ${story.id}] "${story.title}": Count ${count} chapters, Range [${min} - ${max}]. Gaps: ${gaps.slice(0, 5).join(', ')}${gaps.length > 5 ? '...' : ''}`);
  }
}

run();
