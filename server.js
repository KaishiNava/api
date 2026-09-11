const express = require('express')
const cors = require('cors')
const rateLimit = require('express-rate-limit')
const am = require('./am')

const app = express()
const PORT = process.env.PORT || 3000

const WEB_API_KEY = process.env.WEB_API_KEY || 'dev-key-ganti-di-production'

const ALLOWED_ORIGINS = [
  'https://kyzx.my.id',
  'https://www.kyzx.my.id',
  'https://kyzx.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001'
]

app.set('trust proxy', 1)

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    if (/\.vercel\.app$/.test(origin)) return cb(null, true)
    cb(new Error('Not allowed by CORS'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['content-type', 'x-api-key']
}))

app.use(express.json({ limit: '1mb' }))

// Rate limit
app.use('/api/am/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: am.wrapResponse({
    ok: false,
    status: 'rate_limited',
    message: 'Terlalu banyak request. Coba lagi nanti.'
  })
}))

// API Key
app.use('/api/am/', (req, res, next) => {
  const key = req.headers['x-api-key']
  if (key !== WEB_API_KEY) {
    return res.status(401).json(am.wrapResponse({
      ok: false,
      status: 'unauthorized',
      message: 'API key tidak valid'
    }))
  }
  next()
})

// ============================================
// ROOT
// ============================================
app.get('/', (req, res) => {
  res.json(am.wrapResponse({
    ok: true,
    status: 'online',
    service: 'KyZX Premium Activator API',
    message: 'API siap digunakan'
  }))
})

// ============================================
// STEP 1 — Kirim Magic Link
// ============================================
app.post('/api/am/send', async (req, res) => {
  try {
    const { email } = req.body || {}
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json(am.wrapResponse({
        ok: false,
        status: 'invalid',
        message: 'Email tidak valid',
        step: 1
      }))
    }
    const result = await am.link(email.trim())
    res.status(result.ok ? 200 : 400).json(result)
  } catch (e) {
    res.status(500).json(am.wrapResponse({
      ok: false, status: 'error', message: e.message, step: 1
    }))
  }
})

// ============================================
// STEP 2 — Verify Magic Link
// ============================================
app.post('/api/am/verify', async (req, res) => {
  try {
    const { email, link } = req.body || {}
    if (!email || !link) {
      return res.status(400).json(am.wrapResponse({
        ok: false, status: 'invalid',
        message: 'email & magic link wajib diisi', step: 2
      }))
    }
    const result = await am.verify(email.trim(), link.trim())
    res.status(result.ok ? 200 : 400).json(result)
  } catch (e) {
    res.status(500).json(am.wrapResponse({
      ok: false, status: 'error', message: e.message, step: 2
    }))
  }
})

// ============================================
// STEP 3 — Aktivasi Premium
// ============================================
app.post('/api/am/premium', async (req, res) => {
  try {
    const { email, idToken } = req.body || {}
    if (!idToken) {
      return res.status(400).json(am.wrapResponse({
        ok: false, status: 'invalid',
        message: 'idToken wajib diisi', step: 3
      }))
    }
    const result = await am.premium(idToken, email ? email.trim() : null)
    res.status(result.ok ? 200 : 400).json(result)
  } catch (e) {
    res.status(500).json(am.wrapResponse({
      ok: false, status: 'error', message: e.message, step: 3
    }))
  }
})

// ============================================
// ALL-IN-ONE — Verify + Premium
// ============================================
app.post('/api/am/activate', async (req, res) => {
  try {
    const { email, link } = req.body || {}
    if (!email || !link) {
      return res.status(400).json(am.wrapResponse({
        ok: false, status: 'invalid',
        message: 'email & magic link wajib diisi'
      }))
    }

    const v = await am.verify(email.trim(), link.trim())
    if (!v.ok) {
      return res.status(400).json(am.wrapResponse({
        ok: false,
        status: 'verify_failed',
        message: 'Verifikasi magic link gagal',
        step: 2,
        email: email.trim(),
        why: v.why
      }))
    }

    const p = await am.premium(v.idToken, email.trim())
    if (!p.ok) {
      return res.status(400).json(am.wrapResponse({
        ok: false,
        status: 'premium_failed',
        message: 'Aktivasi premium gagal',
        step: 3,
        email: email.trim(),
        uid: v.uid,
        why: p.why
      }))
    }

    res.json(am.wrapResponse({
      ok: true,
      status: 'success',
      message: 'Premium Alight Motion berhasil diaktifkan!',
      email: email.trim(),
      uid: v.uid,
      isNewUser: v.isNewUser,
      orderId: p.orderId,
      plan: p.plan,
      isPremium: true,
      activatedAt: p.activatedAt,
      expiresIn: p.expiresIn,
      features: p.features
    }))
  } catch (e) {
    res.status(500).json(am.wrapResponse({
      ok: false, status: 'error', message: e.message
    }))
  }
})

// ============================================
// STATUS
// ============================================
app.get('/api/am/status', async (req, res) => {
  try {
    const { email } = req.query
    if (!email) return res.status(400).json(am.wrapResponse({
      ok: false, status: 'invalid', message: 'email wajib'
    }))
    const result = await am.checkPremium(email)
    res.json(result)
  } catch (e) {
    res.status(500).json(am.wrapResponse({
      ok: false, status: 'error', message: e.message
    }))
  }
})

// 404
app.use((req, res) => res.status(404).json(am.wrapResponse({
  ok: false, status: 'not_found', message: 'Endpoint tidak ditemukan'
})))

// Error handler
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json(am.wrapResponse({
      ok: false, status: 'cors_blocked', message: 'Domain tidak diizinkan'
    }))
  }
  res.status(500).json(am.wrapResponse({
    ok: false, status: 'error', message: err.message
  }))
})

app.listen(PORT, () => {
  console.log(`✅ ${am.BRAND.brand} API running on port ${PORT}`)
  console.log(`👨‍💻 Developer: ${am.BRAND.developer}`)
})