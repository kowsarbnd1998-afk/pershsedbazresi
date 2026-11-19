/**
 * پل ورودی Vercel: درخواست Node را به Request استاندارد تبدیل می‌کند،
 * به همان کد Worker می‌دهد و پاسخ را برمی‌گرداند.
 * تمام مسیرهای /api/... به این فایل می‌رسند.
 */
import worker from './_lib/worker.js';
import { createD1 } from './_lib/d1-libsql.js';

// صفحه‌های ثابت با Vercel سرو می‌شوند؛ این فقط پشتیبان است.
const ASSETS = {
  async fetch() {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};

let db = null;
function getDb() {
  if (!db) {
    db = createD1({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return db;
}

function readRaw(req) {
  if (req.readableEnded) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : null));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const proto = String(
      req.headers['x-forwarded-proto'] || (req.socket && req.socket.encrypted ? 'https' : 'http')
    ).split(',')[0].trim();

    const route = req.query && req.query.route;
    const routePath = Array.isArray(route) ? route.join('/') : route ? String(route) : '';

    const raw = req.url || '/';
    const qi = raw.indexOf('?');
    const search = qi >= 0 ? raw.slice(qi) : '';
    let path = qi >= 0 ? raw.slice(0, qi) : raw;
    if (!path.startsWith('/api/')) path = '/api/' + routePath;

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === 'host' || k === 'connection' || k === 'content-length') continue;
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else if (v !== undefined && v !== null) headers.set(k, String(v));
    }

    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.body !== undefined && req.body !== null) {
        if (Buffer.isBuffer(req.body)) body = new Uint8Array(req.body);
        else if (typeof req.body === 'string') body = req.body;
        else body = JSON.stringify(req.body);
      } else {
        const rawBody = await readRaw(req);
        if (rawBody) body = new Uint8Array(rawBody);
      }
    }

    const request = new Request(`${proto}://${host}${path}${search}`, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
    });

    const response = await worker.fetch(request, { DB: getDb(), ASSETS });

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') return;
      res.setHeader(key, value);
    });
    const cookies =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : response.headers.get('set-cookie')
          ? [response.headers.get('set-cookie')]
          : [];
    if (cookies.length) res.setHeader('set-cookie', cookies);

    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error('vercel handler failed', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'خطای داخلی سرور. لطفاً دوباره تلاش کنید.' }));
  }
}
