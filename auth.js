require('dotenv').config(); // ✅ MUST be first — loads env before anything else

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
// ✅ Removed unused 'crypto' import

const app = express();
app.use(express.json());
app.use(cors({ origin: ['http://127.0.0.1:5000', 'http://localhost:5000','https://shivashaktipattusaree.onrender.com'] }));

// ══════════════════════════════════════════════
// ENV VARIABLES
// ══════════════════════════════════════════════
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI;
const SENDER_EMAIL         = process.env.SENDER_EMAIL;
const SENDER_APP_PASSWORD  = process.env.SENDER_APP_PASSWORD;

const ALLOWED_EMAILS = [
  'shivashaktipattusarees@gmail.com',
  'second-admin@gmail.com'
];

// ══════════════════════════════════════════════
// OTP SETTINGS
// ══════════════════════════════════════════════
const OTP_EXPIRY_SECONDS = 300;
const MAX_OTP_ATTEMPTS   = 5;
const otpStore = {};

// ══════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════

// Health check
app.get('/', (req, res) => res.send('Auth server running'));
app.get('/auth/health', (req, res) => res.json({ status: 'auth server running', port: process.env.AUTH_PORT || 5001 }));

// ── Google OAuth Redirect ──
app.get('/auth/google', (req, res) => {
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'offline',
    prompt:        'consent'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// ── Google OAuth Callback ──
app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) return res.send(popupHtml({ error: error || 'Login cancelled' }));

  try {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri:  GOOGLE_REDIRECT_URI,
      grant_type:    'authorization_code'
    });

    const tokens = tokenRes.data;
    if (tokens.error) return res.send(popupHtml({ error: tokens.error_description || tokens.error }));

    const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });

    const { email, name, picture } = userRes.data;
    res.send(popupHtml({ email, name, picture }));

  } catch (e) {
    res.send(popupHtml({ error: e.message }));
  }
});

// ── Send OTP ──
app.post('/auth/send-otp', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();

  if (!ALLOWED_EMAILS.map(e => e.toLowerCase()).includes(email)) {
    return res.status(403).json({ error: 'Unauthorised email' });
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));

  otpStore[email] = {
    otp,
    expiresAt: Date.now() + OTP_EXPIRY_SECONDS * 1000,
    attempts: 0
  };

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: SENDER_EMAIL, pass: SENDER_APP_PASSWORD }
    });

    await transporter.sendMail({
      from:    SENDER_EMAIL,
      to:      email,
      subject: '🔐 Shivashakti Admin OTP',
      html: `
        <div style="font-family:Georgia,serif;max-width:480px;margin:auto;
                    background:#fdf6ec;border:1px solid #c9a84c;
                    border-radius:12px;padding:40px;text-align:center;">
          <h2 style="color:#8b0000;letter-spacing:2px;margin-bottom:4px;">
            Shivashakti Pattu Sarees
          </h2>
          <p style="color:#8b6040;font-size:0.85rem;margin-bottom:30px;">
            Admin Panel · One-Time Password
          </p>
          <p style="color:#3d1f00;font-size:1rem;margin-bottom:16px;">Your secure OTP is:</p>
          <div style="background:#8b0000;color:#e2c06a;
                      font-size:2.8rem;font-weight:700;letter-spacing:14px;
                      padding:20px 30px;border-radius:10px;
                      display:inline-block;margin-bottom:24px;">
            ${otp}
          </div>
          <p style="color:#8b6040;font-size:0.88rem;line-height:1.7;margin-bottom:10px;">
            Valid for <strong>5 minutes</strong> only.<br>Do not share this with anyone.
          </p>
          <p style="color:#c0392b;font-size:0.82rem;">
            If you didn't request this, ignore this email.
          </p>
        </div>
      `
    });

    console.log(`[AUTH] OTP sent to ${email}`);
    res.json({ message: 'OTP sent successfully' });

  } catch (e) {
    console.error('[AUTH ERROR]', e.message);
    res.status(500).json({ error: `Failed to send email: ${e.message}` });
  }
});

// ── Verify OTP ──
app.post('/auth/verify-otp', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const otp   = (req.body.otp   || '').trim();

  const record = otpStore[email];

  if (!record) return res.status(400).json({ error: 'No OTP found. Please request a new one.' });

  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    delete otpStore[email];
    return res.status(429).json({ error: 'Too many failed attempts. Please sign in again.' });
  }

  if (Date.now() > record.expiresAt) {
    delete otpStore[email];
    return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
  }

  if (otp !== record.otp) {
    otpStore[email].attempts += 1;
    const remaining = MAX_OTP_ATTEMPTS - otpStore[email].attempts;
    return res.status(400).json({ error: `Incorrect OTP. ${remaining} attempt(s) left.` });
  }

  delete otpStore[email];
  console.log(`[AUTH] OTP verified for ${email}`);
  res.json({ success: true });
});

// ══════════════════════════════════════════════
// HELPER: Popup HTML
// ══════════════════════════════════════════════
function popupHtml({ email = '', name = '', picture = '', error = '' }) {
  const payload = JSON.stringify({ email, name, picture, error });
  return `<!DOCTYPE html>
<html>
<head><title>Authenticating…</title></head>
<body style="font-family:sans-serif;text-align:center;padding:60px;color:#555;background:#fdf6ec;">
  <p>${error ? '❌ ' + error : '✅ Signed in! Closing window…'}</p>
  <script>
    const targets = ['http://127.0.0.1:5000', 'http://localhost:5000'];
    targets.forEach(origin => {
      try { window.opener && window.opener.postMessage(${payload}, origin); } catch(e) {}
    });
    setTimeout(() => window.close(), 800);
  <\/script>
</body>
</html>`;
}

// ══════════════════════════════════════════════
// START SERVER — Single app.listen only
// ══════════════════════════════════════════════
const AUTH_PORT = process.env.AUTH_PORT || 5001;
app.listen(AUTH_PORT, () => {
  console.log('=============================================');
  console.log(`  Shivashakti Auth Server — PORT ${AUTH_PORT}`);
  console.log('=============================================');
});
