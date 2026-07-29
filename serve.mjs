import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3020;
const mime = { '.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.mp4':'video/mp4' };
http.createServer((req,res)=>{
  const url = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(__dirname, url);
  // Directory requests ("/", "/powerlifting/") resolve to their index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  const ext = path.extname(filePath).toLowerCase();
  if(!fs.existsSync(filePath)){ res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200,{ 'Content-Type': mime[ext]||'application/octet-stream', 'Cache-Control':'no-store, no-cache, must-revalidate' });
  fs.createReadStream(filePath).pipe(res);
}).listen(PORT,()=>console.log('http://localhost:'+PORT));
