const fs=require('fs');const {Pool}=require('pg');
const src=fs.readFileSync(__dirname+'/_a10_backup.js','utf8').match(/connectionString:'([^']+)'/)[1];
const p=new Pool({connectionString:src,ssl:{rejectUnauthorized:false}});
const B=String.fromCharCode(92);
const glue=new RegExp('([.!?…:”"])(?=[A-ZÀ-Ỵ—])|[.!?…:”"] — ','g');
(async()=>{const r=await p.query('select chapter_number,title,content from chapters where story_id=7 order by chapter_number');
for(const c of r.rows){const ps=[...c.content.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(m=>m[1]);let g=0;for(const t of ps)g+=(t.match(/[.!?…:”"](?=[A-ZÀ-Ỵ—])/g)||[]).length;
if(g>=5)console.log(c.chapter_number,c.title.slice(0,40),'p='+ps.length,'glue='+g);}
await p.end();})();
