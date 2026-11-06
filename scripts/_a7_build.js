// ARC 7 (ch81-84) truyện 7. node scripts/_a7_build.js [--apply]
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..'),BK=path.join(ROOT,'backup_arc7'),OUT=path.join(BK,'new');
fs.mkdirSync(OUT,{recursive:true});
const OPS=require('./a7/ops.js');
const APPLY=process.argv.includes('--apply');
let bad=0;const log=console.log;
const fixTxt=s=>s.replace(/!\s!\s!/g,'!!!').replace(/!\s!+/g,'!!').replace(/\?\s!/g,'?!').replace(/\s+([,.!?])/g,'$1');
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
for(const n of [81,82,83,84]){
  const orig=fs.readFileSync(path.join(BK,`ch${n}.txt`),'utf8').split('\n').filter(l=>l.trim());
  let lines;
  if(n===81) lines=fs.readFileSync(path.join(__dirname,'a7','ch81.new.txt'),'utf8').split('\n').map(l=>l.trim()).filter(Boolean);
  else{
    const ops=OPS[n];lines=[];
    orig.forEach((l,i)=>{const k=i+1;if(k in ops){const v=ops[k];if(v===null)return;Array.isArray(v)?lines.push(...v):lines.push(v);}else lines.push(l.trim());});
  }
  lines=lines.map(fixTxt);
  const out=[];for(const l of lines){if(l==='✦ ✦ ✦'&&out[out.length-1]==='✦ ✦ ✦')continue;out.push(l);}
  const html=out.map(l=>`<p>${esc(l)}</p>`).join('');
  fs.writeFileSync(path.join(OUT,`ch${n}.html`),html);
  const o=fs.readFileSync(path.join(BK,`ch${n}.html`),'utf8');
  const ratio=(html.length/o.length).toFixed(2);
  log(`ch${n}: ${o.length} -> ${html.length} (x${ratio}), ${out.length} dòng, img ${(html.match(/<img/g)||[]).length}/${(o.match(/<img/g)||[]).length}`);
}
const forbid=[[/Ký chủ|《|》/,'Lu/ký chủ'],[/vũ kỹ/i,'vũ kỹ'],[/Châu Á|Châu Lục|châu Lục/,'Châu'],[/Công Lí/,'Công Lí'],[/dụng trứng|na phù/,'typo'],[/thân phận thật/,'D6'],[/Lê Anh Hoàng/,'D10'],[/! !|\? !/,'dấu']];
for(let n=81;n<=84;n++){const h=fs.readFileSync(path.join(OUT,`ch${n}.html`),'utf8');
  for(const [re,name] of forbid){const m=h.match(re);if(m){log(`CẤM ch${n} ${name}: ${m[0]}`);bad++;}}
  if(n>=82&&/Hoàng Kim Long Kích/.test(h)){bad++;}
}
log(bad?'LỖI '+bad:'PASS');
if(bad)process.exit(1);
if(APPLY){const {Pool}=require('pg');
 const pool=new Pool({connectionString:fs.readFileSync(path.join(__dirname,'_a6_backup.js'),'utf8').match(/connectionString:'([^']+)'/)[1],ssl:{rejectUnauthorized:false}});
 (async()=>{for(let n=81;n<=84;n++){const h=fs.readFileSync(path.join(OUT,`ch${n}.html`),'utf8');
  const r=await pool.query('update chapters set content=$1 where story_id=7 and chapter_number=$2',[h,n]);console.log('UPDATE ch'+n,r.rowCount);}
  await pool.end();})();}
