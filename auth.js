// auth.js
const express = require('express');
const axios = require('axios');

const router = express.Router();

// ═════════════════════════════════════
// GOOGLE OAUTH
// ═════════════════════════════════════

router.get('/google', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent'
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    return res.send(`<h3>Login Failed: ${error || 'No code received'}</h3>`);
  }

  try {
    const tokenRes = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code'
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token } = tokenRes.data;

    const userRes = await axios.get(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    const { email, name, picture } = userRes.data;

    res.send(`
      <h2>Login Successful ✅</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <img src="${picture}" width="120"/>
    `);

  } catch (err) {
    res.send(`<h3>Error: ${err.message}</h3>`);
  }
});

// ═════════════════════════════════════
// OTP SYSTEM
// ═════════════════════════════════════

const OTP_EXPIRY_SECONDS = 300;
const MAX_OTP_ATTEMPTS = 5;
const otpStore = {};

const ALLOWED_EMAILS = [
  'shivashaktipattusarees@gmail.com',
  'second-admin@gmail.com'
];

router.post('/send-otp', (req, res) => {
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

  console.log(`[AUTH] OTP for ${email}: ${otp}`);

  res.json({ message: 'OTP sent (check server console)' });
});

router.post('/verify-otp', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const otp = (req.body.otp || '').trim();

  const record = otpStore[email];

  if (!record)
    return res.status(400).json({ error: 'No OTP found' });

  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    delete otpStore[email];
    return res.status(429).json({ error: 'Too many attempts' });
  }

  if (Date.now() > record.expiresAt) {
    delete otpStore[email];
    return res.status(400).json({ error: 'OTP expired' });
  }

  if (otp !== record.otp) {
    record.attempts++;
    return res.status(400).json({ error: 'Incorrect OTP' });
  }

  delete otpStore[email];
  res.json({ success: true });
});

module.exports = router;
