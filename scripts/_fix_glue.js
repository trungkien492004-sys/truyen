const fs=require('fs');const {Pool}=require('pg');
const src=fs.readFileSync(__dirname+'/_a10_backup.js','utf8').match(/connectionString:'([^']+)'/)[1];
const p=new Pool({connectionString:src,ssl:{rejectUnauthorized:false}});
const TARGETS=process.argv.slice(3).map(Number);const APPLY=process.argv[2]==='apply';
function splitPara(t){
  // ngắt sau dấu kết câu/dấu hai chấm khi chữ hoa hoặc gạch thoại dính liền
  let out=t.replace(/([.!?…:])(?=[A-ZÀ-Ỵ—])/g,'$1\u0001');
  // gạch thoại dính sau chữ/dấu khác (vd "xoa nữa— Ơ")
  out=out.replace(/([^\s\u0001>])(?=— )/g,'$1\u0001');
  return out.split('\u0001').map(s=>s.trim()).filter(Boolean);
}
(async()=>{for(const n of TARGETS){
  const r=await p.query('select id,title,content from chapters where story_id=7 and chapter_number=$1',[n]);const c=r.rows[0].content;
  fs.writeFileSync(__dirname+`/../backup_glue/ch${n}.html`,c);
  const ps=[...c.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(m=>m[1]);
  const np=[];for(const t of ps){const parts=splitPara(t);for(const x of parts)np.push(x);}
  const nc=np.map(x=>'<p>'+x+'</p>').join('');
  console.log('DB',n,r.rows[0].title,'p:',ps.length,'->',np.length,'| chữ:',c.replace(/<[^>]+>/g,'').length,'->',nc.replace(/<[^>]+>/g,'').length);
  if(n===TARGETS[0]){np.slice(0,8).forEach(x=>console.log('  ·',x.slice(0,110)));}
  const left=np.filter(x=>x.length>700).length;console.log('  đoạn >700 ký tự còn lại:',left);
  if(APPLY){await p.query('update chapters set content=$1 where id=$2',[nc,r.rows[0].id]);console.log('  đã cập nhật');}
}await p.end();})();
