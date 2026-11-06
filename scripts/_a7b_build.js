// ARC 7 ch85-90. node scripts/_a7b_build.js [--apply]
const fs=require('fs'),path=require('path');
const BK=path.join(__dirname,'..','backup_arc7'),OUT=path.join(BK,'new');
fs.mkdirSync(OUT,{recursive:true});
const {OV,CH}=require('./a7/ops2.js');
const APPLY=process.argv.includes('--apply');
const SRC={};
for(let n=85;n<=91;n++)SRC[n]=fs.readFileSync(path.join(BK,`ch${n}.txt`),'utf8').split('\n').filter(l=>l.trim());
let bad=0;const log=console.log;
const fixTxt=s=>s.replace(/!\s!\s!/g,'!!!').replace(/!\s!+/g,'!!').replace(/\?\s!/g,'?!').replace(/\s+([,.!?])/g,'$1').replace(/\s+"$/,'"').replace(/ăn chọn/g,'ăn trọn').replace(/Lý Long An/g,'Lê Long An').replace(/[Cc]hâu Lục/g,'Đại Lục').replace(/[Cc]hâu Á/g,'Á Đại Lục').replace(/vũ kỹ/g,'võ kỹ').replace(/Công Lí/g,'Công Lý').replace(/\s{2,}/g,' ').trim();
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const used=new Set();
function get(ch,from,to){const out=[];for(let k=from;k<=to;k++){const key=ch+':'+k;const raw=SRC[ch][k-1];if(raw===undefined){log('THIẾU dòng',key);bad++;continue;}
  if(key in OV){used.add(key);const v=OV[key];if(v===null)continue;Array.isArray(v)?out.push(...v):out.push(v);}else out.push(raw.trim());}return out;}
const TITLES={87:'Chương 87: Cuộc đua bắt đầu'};
const html={};
for(const n of [85,86,87,88,89,90]){
  let lines=[];for(const it of CH[n]){Array.isArray(it)?lines.push(...get(it[0],it[1],it[2])):lines.push(it);}
  const out=[];for(const l0 of lines){const isUL=l0.startsWith('UL:');const l=isUL?l0:fixTxt(l0);if(!l)continue;if(l===('✦ ✦ ✦')&&out[out.length-1]==='✦ ✦ ✦')continue;out.push(l);}
  html[n]=out.map(l=>l.startsWith('UL:')?'<ul>'+l.slice(3).split('||').map(x=>`<li>${esc(fixTxt(x))}</li>`).join('')+'</ul>':`<p>${esc(l)}</p>`).join('');
  fs.writeFileSync(path.join(OUT,`ch${n}.html`),html[n]);
  const o=fs.readFileSync(path.join(BK,`ch${n}.html`),'utf8');
  log(`ch${n}: ${o.length} -> ${html[n].length} (x${(html[n].length/o.length).toFixed(2)}), ${out.length} khối`);
}
// override không dùng
for(const k of Object.keys(OV)){if(!used.has(k)&&!(k.startsWith('86:')&&+k.slice(3)<=76&&false))log('OV chưa dùng:',k);}
const forbid=[/vũ kỹ/i,/Công Lí/,/Châu Á/,/Châu Lục|châu Lục/,/Ký chủ/,/《|》/,/Hoàng Kim Long Kích/,/Bé Kim/,/Lý Long An/,/! !|\? !/,/chiến đầu/,/nhàn dỗi/,/ăn chọn/,/rè chừng/,/dụng trứng/,/na phù/,/lần l$/,/đòn công k$/,/lần l<\/p>/,/đòn công k<\/p>/];
for(const n of [85,86,87,88,89,90]){for(const re of forbid){const m=html[n].match(re);if(m){log(`CẤM ch${n}: ${m[0]}`);bad++;}}}
// mỗi phần thi một lần
const cnt=(re)=>[85,86,87,88,89,90].map(n=>(html[n].match(re)||[]).length);
log('so tốc độ (Phần thi thứ 4):',cnt(/Phần thi thứ 4|phần thi thứ tư/g));
log('so kiến thức:',cnt(/so kiến thức\. Chúng/g));
log('bọ cạp (đàn):',cnt(/đàn bọ cạp khổng lồ/g));
log('Kiệt giữ "Ngọc Lâm Chung":',cnt(/Ngọc Lâm Chung/g));
log(bad?'LỖI '+bad:'PASS');
if(bad)process.exit(1);
if(APPLY){const {Pool}=require('pg');
 const pool=new Pool({connectionString:fs.readFileSync(path.join(__dirname,'_a6_backup.js'),'utf8').match(/connectionString:'([^']+)'/)[1],ssl:{rejectUnauthorized:false}});
 (async()=>{for(const n of [85,86,87,88,89,90]){
  const r=TITLES[n]?await pool.query('update chapters set content=$1,title=$2 where story_id=7 and chapter_number=$3',[html[n],TITLES[n],n]):await pool.query('update chapters set content=$1 where story_id=7 and chapter_number=$2',[html[n],n]);
  console.log('UPDATE ch'+n,r.rowCount);}await pool.end();})();}
