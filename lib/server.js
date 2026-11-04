import express from 'express';
import { createServer } from 'http';
import { timingSafeEqual } from 'crypto';
import { parsePhoneNumber as PhoneNumber } from 'awesome-phonenumber';
import QRCode from 'qrcode';
import config from '../config.js';
const packageInfo = {
    name: config.botName || 'MEGA-MD',
    version: config.version || '6.0.0',
    description: config.description || 'WhatsApp Bot',
    author: config.author || 'GlobalTechInfo'
};
const app = express();
const server = createServer(app);
const PORT = config.port || 5000;
app.set('trust proxy', 1);
app.use(express.json({ limit: '2kb' }));
let pairingSocket = null;
let pairingCredentials = null;
let pairingConnection = 'starting';
let pairingQr = null;
let pairingQrDataUrl = null;
let pairingCodeInProgress = false;
let nextPairingCodeAt = 0;
const failedAuthAttempts = new Map();
const PAIRING_PASSWORD = process.env.PAIRING_PAGE_PASSWORD || '';

export function attachPairingSocket(socket, credentials) {
    pairingSocket = socket;
    pairingCredentials = credentials;
    pairingConnection = credentials.registered ? 'connected' : 'connecting';
    pairingQr = null;
    pairingQrDataUrl = null;
}

export function updatePairingStatus({ connection, qr }) {
    if (qr) {
        pairingConnection = 'qr_ready';
        pairingQr = qr;
        pairingQrDataUrl = null;
        QRCode.toDataURL(qr)
            .then((dataUrl) => {
                if (pairingQr === qr)
                    pairingQrDataUrl = dataUrl;
            })
            .catch((error) => console.error('Failed to render pairing QR:', error.message));
    }
    if (connection === 'open') {
        pairingConnection = 'connected';
        pairingQr = null;
        pairingQrDataUrl = null;
    }
    else if (connection === 'close') {
        pairingConnection = 'disconnected';
        pairingQr = null;
        pairingQrDataUrl = null;
    }
    else if (connection === 'connecting' && !pairingQr) {
        pairingConnection = 'connecting';
    }
}

function requirePairingPassword(req, res, next) {
    if (!PAIRING_PASSWORD)
        return res.status(503).json({ error: 'Pairing page is not configured. Set PAIRING_PAGE_PASSWORD.' });

    const ip = req.ip;
    const now = Date.now();
    const attempts = failedAuthAttempts.get(ip);
    if (attempts && attempts.count >= 10 && now - attempts.startedAt < 15 * 60 * 1000)
        return res.status(429).json({ error: 'Too many login attempts. Try again later.' });

    const provided = req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    const providedBuffer = Buffer.from(provided);
    const passwordBuffer = Buffer.from(PAIRING_PASSWORD);
    const valid = providedBuffer.length === passwordBuffer.length
        && timingSafeEqual(providedBuffer, passwordBuffer);
    if (!valid) {
        const current = attempts && now - attempts.startedAt < 15 * 60 * 1000
            ? attempts
            : { count: 0, startedAt: now };
        current.count += 1;
        failedAuthAttempts.set(ip, current);
        if (failedAuthAttempts.size > 1000)
            failedAuthAttempts.delete(failedAuthAttempts.keys().next().value);
        return res.status(401).json({ error: 'Incorrect pairing page password.' });
    }

    failedAuthAttempts.delete(ip);
    next();
}

app.get('/', (req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#07130f">
  <title>${packageInfo.name} · WhatsApp pairing</title>
  <style>
    :root{color-scheme:dark;--bg:#07130f;--card:#10211b;--green:#25d366;--muted:#a2b3aa}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at top,#163c2b,var(--bg) 62%);color:#f4fff8;font:16px system-ui,sans-serif;display:grid;place-items:center;padding:24px}
    main{width:min(100%,520px);padding:30px;background:var(--card);border:1px solid #294438;border-radius:20px;box-shadow:0 24px 80px #0008}
    h1{margin:0 0 8px;font-size:1.75rem}p{color:var(--muted);line-height:1.5}.tabs{display:flex;gap:8px;margin:22px 0}
    button,input{font:inherit;border-radius:10px;padding:12px;border:1px solid #375347}button{cursor:pointer;background:#1a3528;color:#f4fff8}
    button.active,button.primary{background:var(--green);border-color:var(--green);color:#062111;font-weight:700}
    input{width:100%;background:#08160f;color:#fff;margin:8px 0 12px}.panel{display:none}.panel.active{display:block}
    .row{display:flex;gap:10px}.row button{white-space:nowrap}#qr{display:block;width:min(100%,280px);margin:18px auto;padding:10px;background:white;border-radius:12px}
    #qr[hidden]{display:none}#message{min-height:24px;color:var(--muted)}#code{font:700 1.8rem ui-monospace,monospace;letter-spacing:.12em;text-align:center;color:var(--green)}
    .status{padding:10px 12px;background:#08160f;border-radius:10px;color:var(--muted)}.danger{font-size:.86rem;color:#ffc5b9}a{color:var(--green)}
  </style>
</head>
<body>
<main>
  <h1>${packageInfo.name} WhatsApp pairing</h1>
  <p>Link your own WhatsApp account to this bot. Keep this page and your pairing code private.</p>
  <form id="login">
    <label for="password">Pairing page password</label>
    <div class="row"><input id="password" type="password" autocomplete="current-password" required><button class="primary">Sign in</button></div>
  </form>
  <p id="message" aria-live="polite"></p>
  <section id="pairing" hidden>
    <div class="status" id="status">Checking connection…</div>
    <div class="tabs">
      <button type="button" class="tab active" data-panel="qr-panel">Scan QR</button>
      <button type="button" class="tab" data-panel="code-panel">Phone number</button>
    </div>
    <div class="panel active" id="qr-panel">
      <p>Open WhatsApp → Linked devices → Link a device, then scan this QR code.</p>
      <img id="qr" alt="WhatsApp pairing QR code" hidden>
    </div>
    <div class="panel" id="code-panel">
      <form id="code-form">
        <label for="phone">WhatsApp number with country code</label>
        <div class="row"><input id="phone" inputmode="tel" placeholder="923001234567" autocomplete="tel" required><button class="primary">Get code</button></div>
      </form>
      <p id="code" aria-live="polite"></p>
      <p>In WhatsApp, choose Linked devices → Link a device → Link with phone number.</p>
    </div>
    <button id="logout" type="button">Sign out</button>
  </section>
  <p class="danger">Never share your WhatsApp QR code, pairing code, or session files with anyone.</p>
</main>
<script>
  const login = document.querySelector('#login');
  const pairing = document.querySelector('#pairing');
  const message = document.querySelector('#message');
  const status = document.querySelector('#status');
  const qr = document.querySelector('#qr');
  let token = '';
  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { Authorization: 'Bearer ' + token, ...(options.headers || {}) } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed');
    return result;
  }
  async function refresh() {
    try {
      const state = await api('/api/pairing/status');
      status.textContent = state.connection === 'connected' ? 'WhatsApp is connected.' : 'Connection: ' + state.connection.replace('_', ' ');
      qr.hidden = !state.qr;
      if (state.qr) qr.src = state.qr;
      if (state.connection === 'connected') message.textContent = 'Your WhatsApp account is linked.';
    } catch (error) {
      message.textContent = error.message;
    }
  }
  login.addEventListener('submit', async (event) => {
    event.preventDefault();
    token = document.querySelector('#password').value;
    try {
      await api('/api/pairing/status');
      login.hidden = true;
      document.querySelector('#password').value = '';
      pairing.hidden = false;
      await refresh();
    } catch (error) {
      message.textContent = error.message;
      token = '';
    }
  });
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab,.panel').forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector('#' + tab.dataset.panel).classList.add('active');
  }));
  document.querySelector('#code-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = 'Requesting pairing code…';
    document.querySelector('#code').textContent = '';
    try {
      const result = await api('/api/pairing/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: document.querySelector('#phone').value })
      });
      document.querySelector('#code').textContent = result.code;
      message.textContent = 'Enter this code on your phone. It expires soon.';
    } catch (error) {
      message.textContent = error.message;
    }
  });
  document.querySelector('#logout').addEventListener('click', () => {
    token = '';
    pairing.hidden = true;
    login.hidden = false;
    document.querySelector('#password').value = '';
    message.textContent = '';
  });
  setInterval(() => { if (token) refresh(); }, 5000);
</script>
</body>
</html>`);
});

app.get('/api/pairing/status', requirePairingPassword, async (req, res) => {
    res.json({
        connection: pairingConnection,
        registered: Boolean(pairingCredentials?.registered),
        qr: pairingQrDataUrl
    });
});

app.post('/api/pairing/code', requirePairingPassword, async (req, res) => {
    const { phoneNumber } = req.body || {};
    if (typeof phoneNumber !== 'string' || phoneNumber.length > 32)
        return res.status(400).json({ error: 'Enter a valid phone number with country code.' });
    const digits = phoneNumber.replace(/\D/g, '');
    const parsedPhone = PhoneNumber(`+${digits}`);
    if (!parsedPhone.valid)
        return res.status(400).json({ error: 'Enter a valid phone number with country code.' });
    if (pairingCredentials?.registered)
        return res.status(409).json({ error: 'A WhatsApp account is already connected.' });
    if (!pairingSocket)
        return res.status(503).json({ error: 'WhatsApp is starting. Try again in a moment.' });
    if (pairingCodeInProgress || Date.now() < nextPairingCodeAt)
        return res.status(429).json({ error: 'Please wait before requesting another pairing code.' });

    pairingCodeInProgress = true;
    nextPairingCodeAt = Date.now() + 30_000;
    try {
        const rawCode = await pairingSocket.requestPairingCode(digits);
        const code = rawCode?.match(/.{1,4}/g)?.join('-') || rawCode;
        if (!code)
            throw new Error('WhatsApp returned an empty pairing code');
        res.json({ code });
    }
    catch (error) {
        console.error('Failed to request WhatsApp pairing code:', error.message);
        res.status(502).json({ error: 'WhatsApp could not generate a pairing code. Try again shortly.' });
    }
    finally {
        pairingCodeInProgress = false;
    }
});

app.get('/status', (req, res) => {
    const uptimeSeconds = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    const uptimeString = `${hours}h ${minutes}m ${seconds}s`;
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${packageInfo.name.toUpperCase()} Status</title>
        <style>
            :root { --primary: #25d366; --bg: #0f172a; --card-bg: rgba(30, 41, 59, 0.7); }
            body { 
                margin: 0; padding: 0; background: var(--bg); color: white; 
                font-family: 'Inter', system-ui, sans-serif;
                display: flex; justify-content: center; align-items: center; min-height: 100vh;
            }
            .container {
                background: var(--card-bg); backdrop-filter: blur(12px);
                border: 1px solid rgba(255,255,255,0.1); padding: 30px;
                border-radius: 24px; width: 90%; max-width: 400px; text-align: center;
                box-shadow: 0 20px 50px rgba(0,0,0,0.5);
            }
            .status-badge {
                display: inline-flex; align-items: center; background: rgba(37, 211, 102, 0.1);
                color: var(--primary); padding: 5px 15px; border-radius: 50px;
                font-size: 0.8rem; font-weight: bold; margin-bottom: 20px;
            }
            .dot { height: 8px; width: 8px; background: var(--primary); border-radius: 50%; margin-right: 8px; box-shadow: 0 0 10px var(--primary); }
            h1 { margin: 0; font-size: 1.8rem; letter-spacing: 1px; }
            .desc { color: #94a3b8; margin: 10px 0 25px 0; font-size: 0.9rem; }
            .grid { display: grid; gap: 12px; }
            .item { 
                background: rgba(0,0,0,0.2); padding: 12px 18px; border-radius: 12px;
                display: flex; justify-content: space-between; align-items: center;
            }
            .label { color: #64748b; font-size: 0.75rem; text-transform: uppercase; font-weight: 800; }
            .val { font-weight: 600; font-family: monospace; color: #f1f5f9; }
            footer { margin-top: 25px; font-size: 0.7rem; color: #475569; letter-spacing: 1px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="status-badge"><span class="dot"></span> SYSTEM ONLINE</div>
            <h1>${packageInfo.name.toUpperCase()}</h1>
            <p class="desc">${packageInfo.description}</p>
            
            <div class="grid">
                <div class="item"><span class="label">Version</span><span class="val">${packageInfo.version}</span></div>
                <div class="item"><span class="label">Author</span><span class="val">${packageInfo.author}</span></div>
                <div class="item"><span class="label">Uptime</span><span class="val">${uptimeString}</span></div>
            </div>

            <footer>POWERED BY GLOBALTECHINFO</footer>
        </div>
    </body>
    </html>
    `);
});
app.get('/health', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        memory: {
            rss: `${Math.round(mem.rss / 1024 / 1024) }MB`,
            heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024) }MB`,
            heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024) }MB`
        },
        version: packageInfo.version,
        bot: packageInfo.name,
        timestamp: new Date().toISOString()
    });
});
app.get('/process', (req, res) => {
    const { send } = req.query;
    if (!send)
        return res.status(400).json({ error: 'Missing send query' });
    res.json({ status: 'Received', data: send });
});
app.get('/chat', (req, res) => {
    const { message, to } = req.query;
    if (!message || !to)
        return res.status(400).json({ error: 'Missing message or to query' });
    res.json({ status: 200, info: 'Message received (integration not implemented)' });
});
export { app, server, PORT };
