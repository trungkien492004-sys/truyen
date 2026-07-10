import os
import re
from googletrans import Translator
from supabase import create_client, Client

# Initialize Supabase
url: str = os.environ.get("SUPABASE_URL", "https://xlaqupbqiwpoprywnkgi.supabase.co")
key: str = os.environ.get("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsYXF1cGJxaXdwb3ByeXdua2dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1ODkxNDcsImV4cCI6MjA5OTE2NTE0N30.v0NZKDhVb4ysx03cmx_aQn6aGBMCO6lWzBUN6--JKB0")
supabase: Client = create_client(url, key)

def get_or_create_story():
    title = "Tử Vong Hồi Đương: 48 Giờ Cứu Vớt Thế Giới"
    res = supabase.table('stories').select('id').eq('title', title).execute()
    if len(res.data) > 0:
        return res.data[0]['id']
    else:
        new_story = {
            'title': title,
            'author': 'Đang cập nhật',
            'description': 'Một vụ tai nạn xe hơi khiến Vương Thông có được năng lực "tử vong hồi đương"...',
            'cover_image': 'https://img.wtr-lab.com/cdn/series/P2sLR_clJet8-4i9VIaPP-ULujWyI-dYeO_GcTTk4-k.png',
            'status': 'Đang ra'
        }
        res2 = supabase.table('stories').insert(new_story).execute()
        return res2.data[0]['id']

def translate_and_upload():
    with open('wtr_content.txt', 'r', encoding='utf-8') as f:
        content = f.read()

    # Extract relevant text
    match = re.search(r'(Chapter 384.*?)(?=Report it here)', content, re.DOTALL)
    if not match:
        print("Could not extract chapter text.")
        return
    text_to_translate = match.group(1).strip()

    # Split text into smaller chunks for googletrans to handle safely
    paragraphs = text_to_translate.split('\n')
    translator = Translator()
    
    translated_paragraphs = []
    print(f"Translating {len(paragraphs)} paragraphs...")
    for idx, p in enumerate(paragraphs):
        p = p.strip()
        if not p:
            translated_paragraphs.append("")
            continue
        try:
            res = translator.translate(p, src='en', dest='vi')
            translated_paragraphs.append(res.text)
        except Exception as e:
            print(f"Error translating paragraph {idx}: {e}")
            translated_paragraphs.append(p)

    vietnamese_content = "\n".join(translated_paragraphs)
    
    # Upload to Supabase
    story_id = get_or_create_story()
    
    chapter_data = {
        'story_id': story_id,
        'chapter_number': 384,
        'title': 'Chương 384: Chúa tể',
        'content': vietnamese_content
    }
    
    # Check if chapter exists
    exist = supabase.table('chapters').select('id').eq('story_id', story_id).eq('chapter_number', 384).execute()
    if len(exist.data) > 0:
        print("Chapter 384 already exists, updating...")
        supabase.table('chapters').update(chapter_data).eq('id', exist.data[0]['id']).execute()
    else:
        print("Inserting Chapter 384...")
        supabase.table('chapters').insert(chapter_data).execute()
        
    print("Done! Chapter uploaded successfully.")

if __name__ == "__main__":
    translate_and_upload()
