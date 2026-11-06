const fs=require('fs'),path=require('path');
const {generateEpub}=require('../services/epubGenerator');
(async()=>{
 const rows=require('../backup_arc7/story7_ch80-91_backup.json');
 const T={87:'Chương 87: Cuộc đua bắt đầu'};
 const chs=rows.map(r=>{const p=path.join(__dirname,'../backup_arc7/new/ch'+r.chapter_number+'.html');
  if(r.chapter_number>=81&&r.chapter_number<=90) return {...r,content:fs.readFileSync(p,'utf8'),title:T[r.chapter_number]||r.title};return r;});
 const buf=await generateEpub({id:7,title:'Điện thoại thần kỳ ở tu chân giới (ch80-91, bản sửa arc 7)',author:'',cover_url:null},chs);
 const out=path.join(__dirname,'../out/dien_thoai_than_ky_arc7.epub');fs.writeFileSync(out,buf);
 const AdmZip=require('adm-zip');const z=new AdmZip(buf);const e=z.getEntries();
 console.log('first entry:',e[0].entryName,'method',e[0].header.method,'entries',e.length);
 const ncx=z.readAsText('OEBPS/toc.ncx');console.log('toc ch87:',ncx.includes('Cuộc đua bắt đầu'),'ch81:',ncx.includes('Hải Thần truyền thừa'));
 let xml=0,badx=0;const {DOMParser}=require('@xmldom/xmldom');
 e.forEach(x=>{if(/\.(xhtml|ncx|opf)$/.test(x.entryName)){xml++;let err=0;new DOMParser({errorHandler:{warning(){},error(){err++},fatalError(){err++}}}).parseFromString(z.readAsText(x.entryName),'text/xml');if(err)badx++;}});
 console.log('xml files',xml,'lỗi parse',badx);
})().catch(e=>{console.error(e);process.exit(1)});
