const fs = require('fs');
const translate = require('google-translate-api-x');
const supabase = require('./config/supabase');

async function getOrCreateStory() {
    const title = "Tử Vong Hồi Đương: 48 Giờ Cứu Vớt Thế Giới";
    const { data: exist, error } = await supabase.from('stories').select('id').eq('title', title);
    
    if (exist && exist.length > 0) {
        return exist[0].id;
    } else {
        const newStory = {
            title: title,
            author: 'Đang cập nhật',
            description: 'Một vụ tai nạn xe hơi khiến Vương Thông có được năng lực "tử vong hồi đương"...',
            cover_url: 'https://img.wtr-lab.com/cdn/series/P2sLR_clJet8-4i9VIaPP-ULujWyI-dYeO_GcTTk4-k.png'
        };
        const { data: res, error: err2 } = await supabase.from('stories').insert(newStory).select();
        if (err2) {
            console.error("Error creating story:", err2);
            throw err2;
        }
        return res[0].id;
    }
}

async function run() {
    const content = fs.readFileSync('wtr_content.txt', 'utf8');
    
    const match = content.match(/Chapter 384[\s\S]*?(?=Report it here)/);
    if (!match) {
        console.error("Could not find chapter text in wtr_content.txt");
        return;
    }
    
    const textToTranslate = match[0].trim();
    const paragraphs = textToTranslate.split('\\n').map(p => p.trim());
    
    console.log(`Translating ${paragraphs.length} paragraphs...`);
    
    const translatedParagraphs = [];
    for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs[i];
        if (!p) {
            translatedParagraphs.push('');
            continue;
        }
        try {
            const res = await translate(p, {to: 'vi', forceBatch: false});
            translatedParagraphs.push(res.text);
        } catch (err) {
            console.error(`Error translating paragraph ${i}:`, err.message);
            translatedParagraphs.push(p);
        }
    }
    
    const vietnameseContent = translatedParagraphs.join('\\n');
    
    console.log("Translation done. Uploading to database...");
    
    const storyId = await getOrCreateStory();
    const chapterData = {
        story_id: storyId,
        chapter_number: 384,
        title: 'Chương 384: Chủ nhân',
        content: vietnameseContent
    };
    
    const { data: exist } = await supabase.from('chapters').select('id').eq('story_id', storyId).eq('chapter_number', 384);
    
    if (exist && exist.length > 0) {
        console.log("Updating existing chapter 384...");
        const { error } = await supabase.from('chapters').update(chapterData).eq('id', exist[0].id);
        if (error) console.error("Error updating:", error);
        else console.log("Success update!");
    } else {
        console.log("Inserting new chapter 384...");
        const { error } = await supabase.from('chapters').insert(chapterData);
        if (error) console.error("Error inserting:", error);
        else console.log("Success insert!");
    }
}

run().catch(console.error);
