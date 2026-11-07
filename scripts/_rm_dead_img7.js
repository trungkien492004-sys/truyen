const {Pool}=require('pg');const fs=require('fs');
const src=fs.readFileSync(__dirname+'/_a10_backup.js','utf8').match(/connectionString:'([^']+)'/)[1];
const pool=new Pool({connectionString:src,ssl:{rejectUnauthorized:false}});
const DEAD='xlaqupbqiwpoprywnkgi.supabase.co';
(async()=>{const c=await pool.connect();try{
 await c.query('begin');
 const r=await c.query("select id,chapter_number,title,content from chapters where story_id=7 and content like '%"+DEAD+"%' order by chapter_number");
 fs.writeFileSync(__dirname+'/../backup_img7/story7_dead_img_chapters.json',JSON.stringify(r.rows,null,1));
 let total=0;
 for(const ch of r.rows){
  let n=0;
  let h=ch.content.replace(/<img\b[^>]*>/gi,m=>{ if(m.includes(DEAD)){n++;return '';} return m;});
  h=h.replace(/<(p|div|figure|a)\b[^>]*>(\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi,'');
  if(h.includes(DEAD)) throw new Error('còn sót host chết ở chương '+ch.chapter_number);
  await c.query('update chapters set content=$1 where id=$2',[h,ch.id]);
  total+=n; console.log('ch'+ch.chapter_number,'gỡ',n,'ảnh',ch.content.length,'->',h.length);
 }
 await c.query('commit');console.log('xong',r.rows.length,'chương',total,'ảnh');
}catch(e){await c.query('rollback');console.error('ROLLBACK',e.message);process.exit(1);}finally{c.release();await pool.end();}})();
