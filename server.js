/**
 * Edwin Web - Servidor en tiempo real (sin dependencias).
 * Uso:  node server.js   (o doble clic en iniciar.bat)
 * Luego abre http://localhost:3000 o, desde otro celular/PC en la misma red WiFi,
 * la dirección http://TU-IP:3000 que aparece en la consola.
 *
 * Tiempo real mediante Server-Sent Events (SSE) + POST: funciona en cualquier
 * navegador moderno y no necesita instalar paquetes de npm.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createInitialState, applyAction } = require('./shared.js');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const MAX_BODY = 20 * 1024 * 1024; // 20 MB (imágenes y notas de voz)

const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
  '/shared.js': ['shared.js', 'application/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8']
};

// ---------- Estado persistente ----------
let state;
try {
  state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!state || state.version !== 3) throw new Error('versión antigua');
} catch (e) {
  state = createInitialState();
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(state), err => {
      if (err) console.error('No se pudo guardar data.json:', err.message);
    });
  }, 400);
}

// ---------- Clientes conectados (SSE) ----------
const clients = new Set(); // { res, userId }

function onlineUserIds() {
  return [...new Set([...clients].map(c => c.userId))];
}

function send(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  clients.forEach(c => c.res.write(data));
}

function broadcastPresence() {
  broadcast({ type: 'PRESENCE', online: onlineUserIds() });
}

function lanUrls() {
  const urls = [];
  Object.values(os.networkInterfaces()).forEach(list => {
    (list || []).forEach(n => {
      if (n.family === 'IPv4' && !n.internal) urls.push(`http://${n.address}:${PORT}`);
    });
  });
  return urls;
}

function dispatch(action) {
  if (applyAction(state, action)) {
    scheduleSave();
    broadcast({ type: 'ACTION', action });
  }
}

// ---------- HTTP ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sanitizeUser(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').slice(0, 40).replace(/[^\w\-áéíóúñü+]/gi, '_');
  if (!id) return null;
  return {
    id,
    phone: String(raw.phone || '').slice(0, 30),
    name: String(raw.name || id).slice(0, 30),
    avatar: String(raw.avatar || '').slice(0, 400),
    color: String(raw.color || '#00a884').slice(0, 20)
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Eventos en tiempo real
  if (req.method === 'GET' && url.pathname === '/api/events') {
    let user;
    try { user = sanitizeUser(JSON.parse(url.searchParams.get('user') || '{}')); } catch (e) { user = null; }
    if (!user) { res.writeHead(400); res.end('usuario inválido'); return; }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 2000\n\n');

    const client = { res, userId: user.id };
    clients.add(client);

    // Registrar usuario y avisar a todos
    dispatch({ type: 'USER_UPSERT', user, at: Date.now() });
    send(res, { type: 'STATE', state, online: onlineUserIds(), urls: lanUrls() });
    broadcastPresence();

    const ping = setInterval(() => res.write(': ping\n\n'), 20000);

    req.on('close', () => {
      clearInterval(ping);
      clients.delete(client);
      if (!onlineUserIds().includes(user.id)) {
        dispatch({ type: 'USER_SEEN', userId: user.id, at: Date.now() });
      }
      broadcastPresence();
    });
    return;
  }

  // Acciones (enviar, editar, borrar, reaccionar, leído, escribiendo...)
  if (req.method === 'POST' && url.pathname === '/api/action') {
    try {
      const action = JSON.parse(await readBody(req));
      if (action.type === 'TYPING') {
        broadcast({ type: 'TYPING', chatId: action.chatId, userId: action.userId, userName: action.userName, isTyping: !!action.isTyping });
      } else {
        if (action.type === 'MESSAGE_NEW' && action.message) action.message.timestamp = Date.now();
        dispatch(action);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // Archivos estáticos
  const file = STATIC_FILES[url.pathname];
  if (req.method === 'GET' && file) {
    fs.readFile(path.join(ROOT, file[0]), (err, content) => {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
      res.end(content);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('No encontrado');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  ✅ WhatsApp Web está funcionando\n');
  console.log(`  En esta PC:        http://localhost:${PORT}`);
  lanUrls().forEach(u => console.log(`  En tu red (WiFi):  ${u}`));
  console.log('\n  Abre la dirección "En tu red" desde otro celular o computadora');
  console.log('  conectado al mismo WiFi. Presiona Ctrl+C para detener.\n');
});
