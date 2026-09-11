const axios = require('axios')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

// ============================================
// KONFIGURASI
// ============================================
const BASE_DOMAIN = 'https://kyzx.my.id'

const cfg = {
  key: 'AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0',
  idt: 'https://www.googleapis.com/identitytoolkit/v3/relyingparty',
  stk: 'https://securetoken.googleapis.com/v1/token',
  vfy: 'https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase',
  domain: BASE_DOMAIN,
  continueUrl: `${BASE_DOMAIN}/`
}

// ============================================
// BRANDING
// ============================================
const BRAND = {
  developer: 'KyZX',
  brand: 'KyZX Premium Activator',
  version: '1.0.0'
}

const wrapResponse = (data) => ({
  developer: BRAND.developer,
  brand: BRAND.brand,
  version: BRAND.version,
  timestamp: new Date().toISOString(),
  ...data
})

// ============================================
// HELPERS
// ============================================
const dip = () =>
  [crypto.randomInt(1, 255), crypto.randomInt(0, 255), crypto.randomInt(0, 255), crypto.randomInt(1, 255)].join('.')

const sp = (h) => ({
  ...h,
  'x-forwarded-for': dip(),
  'x-real-ip': dip(),
  'client-ip': dip(),
  'x-client-ip': dip(),
  'x-originating-ip': dip(),
  'x-cluster-client-ip': dip()
})

const h1 = {
  'content-type': 'application/json',
  'x-android-package': 'com.alightcreative.motion',
  'x-android-cert': 'ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8',
  'user-agent': 'dalvik/2.1.0 (linux; u; android 15; 23127pn0cc build/bp1a.250505.005)'
}

const h2 = {
  'content-type': 'application/json; charset=utf-8',
  'user-agent': 'okhttp/3.12.1',
  'accept-encoding': 'gzip'
}

const J = JSON
const S = String

const bad = (e) => {
  const d = e.response?.data
  return d ? (typeof d === 'object' ? J.stringify(d) : S(d)) : e.message
}

// ============================================
// DATABASE
// ============================================
const dbPath = process.env.DB_PATH || path.join(__dirname, 'database', 'users.json')

const ensureDatabase = () => {
  const dbDir = path.dirname(dbPath)
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, J.stringify({ users: {} }, null, 2))
}

const loadUsers = () => {
  ensureDatabase()
  try {
    return J.parse(fs.readFileSync(dbPath, 'utf8'))
  } catch {
    return { users: {} }
  }
}

const saveUsers = (data) => {
  ensureDatabase()
  fs.writeFileSync(dbPath, J.stringify(data, null, 2))
}

const getUserData = (email) => loadUsers().users?.[email] || null

const saveUserData = (email, data) => {
  const db = loadUsers()
  if (!db.users) db.users = {}
  db.users[email] = { ...data, at: new Date().toISOString() }
  saveUsers(db)
}

// ============================================
// 1. KIRIM MAGIC LINK
// ============================================
async function link(email) {
  const c1 = { identifier: email, continueUri: BASE_DOMAIN }
  const c2 = {
    requestType: 6,
    email: email,
    androidInstallApp: true,
    canHandleCodeInApp: true,
    continueUrl: cfg.continueUrl,
    iosBundleId: 'com.alightcreative.motion',
    androidPackageName: 'com.alightcreative.motion',
    androidMinimumVersion: '585',
    clientType: 'CLIENT_TYPE_ANDROID'
  }

  try {
    await axios.post(`${cfg.idt}/createAuthUri?key=${cfg.key}`, c1, { headers: sp(h1) })
    const r = await axios.post(`${cfg.idt}/getOobConfirmationCode?key=${cfg.key}`, c2, { headers: sp(h1) })

    return wrapResponse({
      ok: true,
      status: 'sent',
      message: 'Magic link berhasil dikirim ke email kamu',
      email,
      step: 1,
      nextStep: 'Buka email, copy link, paste di web'
    })
  } catch (e) {
    return wrapResponse({
      ok: false,
      status: 'failed',
      message: 'Gagal mengirim magic link',
      email,
      step: 1,
      why: bad(e)
    })
  }
}

// ============================================
// EXTRACT OOBCODE
// ============================================
function extractCode(raw) {
  if (!raw) return null
  let s = S(raw).replace(/&amp;/g, '&')
  try { s = decodeURIComponent(s) } catch {}

  try {
    const u = new URL(s)
    let c = u.searchParams.get('oobCode')
    if (!c) {
      const n = u.searchParams.get('link') || u.searchParams.get('q') || u.searchParams.get('url')
      if (n) { try { c = new URL(n).searchParams.get('oobCode') } catch {} }
    }
    if (c) return c.replace(/[^a-zA-Z0-9_-]/g, '')
  } catch {}

  const m = s.match(/oobCode=([a-zA-Z0-9_-]+)/i)
  if (m) return m[1]

  const t = raw.trim()
  if (/^[a-zA-Z0-9_-]{10,}$/.test(t) && !t.includes('://')) return t
  return null
}

// ============================================
// 2. VERIFY
// ============================================
async function verify(email, raw) {
  const c = extractCode(raw)
  if (!c) {
    return wrapResponse({
      ok: false,
      status: 'failed',
      message: 'Magic link tidak valid',
      email,
      step: 2,
      why: 'code tidak ditemukan di link'
    })
  }

  try {
    const a = await axios.post(
      `${cfg.idt}/emailLinkSignin?key=${cfg.key}`,
      { email, oobCode: c, clientType: 'CLIENT_TYPE_ANDROID' },
      { headers: sp(h1) }
    )

    let userInfo = null
    try {
      const b = await axios.post(
        `${cfg.idt}/getAccountInfo?key=${cfg.key}`,
        { idToken: a.data.idToken },
        { headers: sp(h1) }
      )
      userInfo = b.data?.users?.[0] || null
    } catch {}

    return wrapResponse({
      ok: true,
      status: 'verified',
      message: 'Magic link berhasil diverifikasi',
      email,
      step: 2,
      idToken: a.data.idToken,
      refreshToken: a.data.refreshToken,
      uid: a.data.localId,
      isNewUser: !!a.data.isNewUser,
      userInfo
    })
  } catch (e) {
    return wrapResponse({
      ok: false,
      status: 'failed',
      message: 'Verifikasi magic link gagal',
      email,
      step: 2,
      why: bad(e)
    })
  }
}

// ============================================
// 3. PREMIUM
// ============================================
async function premium(idToken, email = null) {
  const orderId = 'kyzx-' + crypto.randomBytes(6).toString('hex')

  const body = {
    data: {
      productId: 'am.full.sub.annual.19q4',
      token: 'mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw',
      skuType: 'subs',
      orderId
    }
  }

  const headers = {
    ...h2,
    authorization: 'Bearer ' + idToken,
    'firebase-instance-id-token': 'cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI'
  }

  const activatedAt = new Date().toISOString()

  try {
    await axios.post(cfg.vfy, body, { headers: sp(headers) })

    if (email) {
      saveUserData(email, {
        idToken,
        pro: true,
        orderId,
        activatedAt
      })
    }

    return wrapResponse({
      ok: true,
      status: 'success',
      message: 'Premium Alight Motion berhasil diaktifkan!',
      step: 3,
      email: email || null,
      orderId,
      plan: 'premium',
      isPremium: true,
      activatedAt,
      expiresIn: '1 tahun',
      features: [
        'Bebas watermark',
        'Unlock semua efek premium',
        'Export resolusi tinggi (4K)',
        'Akses semua font eksklusif',
        'Tanpa iklan'
      ]
    })
  } catch (e) {
    return wrapResponse({
      ok: false,
      status: 'failed',
      message: 'Gagal mengaktifkan premium',
      step: 3,
      email: email || null,
      orderId,
      plan: 'free',
      isPremium: false,
      why: bad(e)
    })
  }
}

// ============================================
// 4. REFRESH
// ============================================
async function refresh(refreshToken) {
  try {
    const r = await axios.post(`${cfg.stk}?key=${cfg.key}`, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
    return wrapResponse({
      ok: true,
      status: 'refreshed',
      idToken: r.data.id_token,
      refreshToken: r.data.refresh_token
    })
  } catch (e) {
    return wrapResponse({ ok: false, status: 'failed', why: bad(e) })
  }
}

// ============================================
// 5. CHECK PREMIUM
// ============================================
async function checkPremium(email) {
  const userData = getUserData(email)
  if (!userData) {
    return wrapResponse({
      ok: false,
      status: 'not_found',
      message: 'Akun belum pernah aktivasi',
      email,
      isPremium: false
    })
  }

  if (userData.pro === true) {
    return wrapResponse({
      ok: true,
      status: 'active',
      message: 'Akun premium aktif',
      email,
      isPremium: true,
      plan: 'premium',
      orderId: userData.orderId || null,
      activatedAt: userData.activatedAt || userData.at
    })
  }

  if (userData.idToken) return await premium(userData.idToken, email)

  return wrapResponse({
    ok: false,
    status: 'inactive',
    email,
    isPremium: false,
    why: 'No valid session'
  })
}

// ============================================
// UTIL
// ============================================
function getSessions() { return loadUsers().users || {} }

function saveSession(email, data) {
  saveUserData(email, {
    idToken: data.idToken || null,
    refreshToken: data.refreshToken || null,
    uid: data.uid || null,
    pro: data.pro || false,
    orderId: data.orderId || null
  })
  return wrapResponse({ ok: true, status: 'saved', email })
}

function deleteSession(email) {
  const db = loadUsers()
  if (db.users && db.users[email]) {
    delete db.users[email]
    saveUsers(db)
    return wrapResponse({ ok: true, status: 'deleted', email })
  }
  return wrapResponse({ ok: false, status: 'not_found', email })
}

module.exports = {
  BASE_DOMAIN,
  BRAND,
  cfg,
  wrapResponse,
  link,
  verify,
  premium,
  refresh,
  extractCode,
  checkPremium,
  getSessions,
  saveSession,
  deleteSession,
  getUserData
}