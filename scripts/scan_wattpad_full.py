import urllib.request
import json
import re
import sys
sys.stdout.reconfigure(encoding='utf-8')

story_url = 'https://www.wattpad.com/api/v3/stories/273327250'
headers = {'User-Agent': 'Mozilla/5.0'}

req = urllib.request.Request(story_url, headers=headers)
with urllib.request.urlopen(req) as resp:
    story_data = json.loads(resp.read().decode('utf-8'))

parts = story_data.get('parts', [])
print(f"Total parts on Wattpad: {len(parts)}")

all_parts_data = []

for idx, p in enumerate(parts):
    pid = p.get('id')
    title = p.get('title')
    text_url = f"https://www.wattpad.com/apiv2/storytext?id={pid}"
    req_t = urllib.request.Request(text_url, headers=headers)
    with urllib.request.urlopen(req_t) as r:
        text = r.read().decode('utf-8', errors='ignore')
    
    # Check for links inside text
    links = re.findall(r'https?://[^\s<"\']+', text)
    print(f"[{idx+1}] ID={pid} | Title={title} | Length={len(text)} | Embedded URLs={links}")
    all_parts_data.append({
        'id': pid,
        'title': title,
        'content': text
    })

with open('wattpad_parts_raw.json', 'w', encoding='utf-8') as f:
    json.dump({'story': story_data, 'parts': all_parts_data}, f, ensure_ascii=False, indent=2)
print("Saved wattpad_parts_raw.json")
