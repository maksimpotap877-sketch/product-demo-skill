import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || Number(process.env.PORT) || 4173;
const variant = args.includes('--second') ? 'second-web' : 'basic-web';
const indexPath = fileURLToPath(new URL(`./${variant}/index.html`, import.meta.url));
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (url.pathname === '/health') {res.end('ready'); return;}
  if (url.pathname === '/demo-login' && req.method === 'POST') {
    res.setHeader('Set-Cookie', 'demo_session=local-example-only; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400');
    res.writeHead(303, {Location:'/protected'}); res.end(); return;
  }
  if (url.pathname === '/login') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><title>Локальный тест авторизации</title><style>body{font:20px Segoe UI;background:#eef1f7;display:grid;place-content:center;height:90vh}main{background:white;padding:48px;border-radius:24px;max-width:650px}button{font:inherit;padding:18px 30px;background:#5452df;color:white;border:0;border-radius:12px}</style><main><h1>Вход в демонстрационный аккаунт</h1><p>Это локальный тест передачи управления. Пароль, почта и внешние аккаунты не нужны.</p><form action="/demo-login" method="post"><button>Войти в демо</button></form><p>Видео, скриншоты и содержимое полей во время входа не записываются.</p></main></html>'); return;
  }
  if (url.pathname === '/protected' && !req.headers.cookie?.includes('demo_session=local-example-only')) {
    res.writeHead(303, {Location:'/login'}); res.end(); return;
  }
  if (!['/', '/index.html', '/protected', '/library', '/collection'].includes(url.pathname)) {res.writeHead(404); res.end(); return;}
  if (req.method !== 'GET') {res.writeHead(405);res.end();return;}
  try {res.setHeader('Content-Type', 'text/html; charset=utf-8');res.end(await readFile(indexPath));}
  catch {res.writeHead(500);res.end('Example unavailable');}
});
server.listen(port, '127.0.0.1', () => process.stdout.write(JSON.stringify({ready:true,url:`http://127.0.0.1:${port}`,pid:process.pid})+'\n'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
