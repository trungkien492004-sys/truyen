const https = require('https');
const fs = require('fs');

const url = 'https://xsw.tw/book/33934/384.html';

const req = https.get(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  },
  timeout: 10000
}, (res) => {
  console.log('Status Code:', res.statusCode);
  console.log('Headers:', res.headers);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Độ dài trang nhận được:', data.length);
    fs.writeFileSync('xsw_384.html', data);
    console.log('Đã lưu file xsw_384.html thành công!');
  });
});

req.on('error', (err) => {
  console.error('Lỗi khi tải trang:', err);
});

req.on('timeout', () => {
  console.log('Yêu cầu bị quá hạn (Timeout)!');
  req.destroy();
});
