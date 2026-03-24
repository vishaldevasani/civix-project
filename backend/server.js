/**
 * Civix — AI Civic Intelligence Platform
 * Backend Server v2.0
 */
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const fs       = require('fs');
const path     = require('path');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  EMAIL_ENABLED:        true,
  EMAIL_FROM:           process.env.EMAIL_FROM
  EMAIL_APP_PASSWORD:   process.env.EMAIL_APP_PASSWORD
  WHATSAPP_ENABLED:     true,
  TWILIO_SID:           process.env.TWILIO_SID
  TWILIO_TOKEN:         process.env.TWILIO_TOKEN         
  WHATSAPP_FROM:        process.env.WHATSAPP_FROM        
  WHATSAPP_TO:          process.env.WHATSAPP_TO          
  DISASTER_INTERVAL_MS: 30000,
  PORT:                 process.env.PORT              
  BRAND:                'Civix',
  BRAND_TAGLINE:        'AI Civic Intelligence Platform',
  BRAND_CITY:           'Hyderabad, Telangana',
};

// ─── EMAIL TRANSPORTER ───────────────────────────────────────────────────────
const mailer = CONFIG.EMAIL_ENABLED
  ? nodemailer.createTransport({ service: 'gmail', auth: { user: CONFIG.EMAIL_FROM, pass: CONFIG.EMAIL_APP_PASSWORD } })
  : null;

// ─── TWILIO ──────────────────────────────────────────────────────────────────
let twilio = null;
if (CONFIG.WHATSAPP_ENABLED) {
  try { twilio = require('twilio')(CONFIG.TWILIO_SID, CONFIG.TWILIO_TOKEN); console.log('[TWILIO] ✓'); }
  catch (e) { console.warn('[TWILIO] Not loaded:', e.message); }
}

// ─── EXPRESS ─────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' })); // Increased for photo uploads (base64)

// ─── PERSISTENT STORAGE ──────────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data.json');

const DEFAULT_DEPARTMENTS = {
  Fire:           { name: 'Fire Department',       head: 'Admin', contact: '+918328376205', email: 'darksun6762@gmail.com', count: 0 },
  Medical:        { name: 'Medical Emergency',     head: 'Admin', contact: '+918328376205', email: 'darksun6762@gmail.com', count: 0 },
  Water:          { name: 'Water Authority',       head: 'Admin', contact: '+918328376205', email: 'darksun6762@gmail.com', count: 0 },
  Electricity:    { name: 'Electricity Board',     head: 'Admin', contact: '+918328376205', email: 'darksun6762@gmail.com', count: 0 },
  Police:         { name: 'Police Department',     head: 'Admin', contact: '+918328376205', email: 'darksun6762@gmail.com', count: 0 },
  Infrastructure: { name: 'PWD / Roads',           head: 'Admin', contact: '+918328376205', email: 'darksun6762@gmail.com', count: 0 },
  Sanitation:     { name: 'Municipal Corporation', head: 'Admin', contact: '+918328376205', email: 'darksun6762@gmail.com', count: 0 },
  Other:          { name: 'General Services',      head: 'Admin', contact: '+918328376205', email: 'darksun6762@gmail.com', count: 0 },
};

// Load saved data from disk, or start fresh
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw  = fs.readFileSync(DATA_FILE, 'utf8');
      const saved = JSON.parse(raw);
      console.log(`[DB] ✅ Loaded ${saved.complaints?.length || 0} complaints, ${saved.alerts?.length || 0} alerts from disk`);
      return saved;
    }
  } catch (e) {
    console.warn('[DB] Could not load data.json — starting fresh:', e.message);
  }
  return null;
}

// Save current state to disk (called after every write operation)
function saveData() {
  try {
    const snapshot = {
      complaints:    db.complaints,
      alerts:        db.alerts,
      notifications: db.notifications,
      departments:   db.departments,
      idCounter,
      alertCounter,
      savedAt:       new Date().toISOString()
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(snapshot, null, 2));
  } catch (e) {
    console.error('[DB] Save failed:', e.message);
  }
}

// Debounced save — avoids writing to disk on every tiny update
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveData, 500);
}

// ─── DATABASE — load from file or initialize fresh ────────────────────────────
const saved = loadData();

const db = {
  complaints:    saved?.complaints    || [],
  alerts:        saved?.alerts        || [],
  notifications: saved?.notifications || [],
  disasters:     [], // always re-fetched fresh — non-India ones will be excluded by new filter
  sseClients:    [],
  departments:   saved?.departments   || DEFAULT_DEPARTMENTS,
};

let idCounter    = saved?.idCounter    || 1;
let alertCounter = saved?.alertCounter || 1;

console.log(`[DB] Starting — next complaint ID: ID-${idCounter}, next alert: ALT-${String(alertCounter).padStart(4,'0')}`);

// ─── ADMIN CREDENTIALS ───────────────────────────────────────────────────────
const ADMINS = {
  admin:          { password: 'admin@123',      department: null,             role: 'Super Admin' },
  fire:           { password: 'fire@123',       department: 'Fire',           role: 'Fire Department' },
  medical:        { password: 'medical@123',    department: 'Medical',        role: 'Medical Emergency' },
  water:          { password: 'water@123',      department: 'Water',          role: 'Water Authority' },
  electricity:    { password: 'electric@123',   department: 'Electricity',    role: 'Electricity Board' },
  police:         { password: 'police@123',     department: 'Police',         role: 'Police Department' },
  infrastructure: { password: 'infra@123',      department: 'Infrastructure', role: 'PWD / Roads' },
  sanitation:     { password: 'sanitation@123', department: 'Sanitation',     role: 'Municipal Corporation' },
  other:          { password: 'other@123',      department: 'Other',          role: 'General Services' },
};

// ─── ENHANCED FALLBACK CLASSIFIER ────────────────────────────────────────────
function classify(text) {
  const t = text.toLowerCase();
  const KW = {
    Fire:           ['fire','smoke','burning','flame','blaze','arson','explosion','ignite','burnt','inferno','ablaze','gas leak','wildfire','house on fire','building on fire','caught fire','lpg','cylinder burst','smells like gas','fire brigade'],
    Medical:        ['accident','injury','unconscious','ambulance','hospital','bleeding','heart attack','sick','medical','emergency','hurt','pain','faint','stroke','died','dead','collapse','seizure','choking','drowning','poisoning','pregnant','not breathing','fracture','serious','critical','chest pain'],
    Water:          ['water','pipe','leak','flood','sewage','drainage','plumbing','supply','contaminated','overflow','puddle','sewer','tap','bore','no water','borewell','canal','waterlogging','blocked drain','dirty water','water cut','murky'],
    Electricity:    ['electric','power','light','transformer','wire','voltage','outage','blackout','shock','current','pole','streetlight','sparks','short circuit','electrocution','no electricity','power cut','load shedding','fallen wire','live wire','tripped','meter'],
    Police:         ['theft','robbery','assault','crime','fight','violence','drug','murder','suspicious','missing','stolen','harassment','chain snatching','burglary','attack','kidnapping','rape','molest','eve teasing','drunk driving','illegal','arms','gambling','threat','stalking','domestic violence','found dead','quarrel'],
    Infrastructure: ['road','pothole','bridge','construction','footpath','signal','traffic','crack','collapse','dangerous','blocked','flyover','encroachment','unauthorized construction','dilapidated','broken road','damaged road','traffic jam','wall collapsed','building'],
    Sanitation:     ['garbage','waste','trash','dirty','clean','sweep','dustbin','mosquito','stray','smell','odor','rats','open defecation','sanitation','hygiene','filth','litter','dumping','stagnant water','dog menace','snake','waste dumped','garbage not collected','overflowing bin'],
  };
  const HIGH = ['fire','explosion','accident','injury','unconscious','bleeding','heart attack','murder','robbery','assault','flood','electrocution','critical','dying','dangerous','urgent','severe','dead','collapse','gas leak','arson','live wire','drowning','kidnap','rape','stabbing','emergency','house on fire','not breathing','serious','life threatening','burst','fire brigade','ambulance'];
  const MED  = ['leak','shortage','crime','suspicious','contaminated','outage','broken','blocked','theft','missing','overflow','pothole','no power','no water','harassment','threat','damage','fallen','stray','crack','smell'];

  const scores = {};
  for (const [cat, words] of Object.entries(KW)) scores[cat] = words.filter(w => t.includes(w)).length;
  let category = 'Other', maxScore = 0;
  for (const [cat, score] of Object.entries(scores)) if (score > maxScore) { maxScore = score; category = cat; }

  let priority = 'LOW';
  if (HIGH.some(w => t.includes(w)))                            priority = 'HIGH';
  else if (MED.some(w => t.includes(w)) || maxScore >= 1)       priority = 'MEDIUM';

  const kws = KW[category]?.filter(w => t.includes(w)).slice(0, 4) || [];
  const kwStr = kws.length ? kws.join(', ') : 'general context';
  const sla = priority === 'HIGH' ? 1 : priority === 'MEDIUM' ? 24 : 72;
  const reasoning = {
    HIGH:   `⚠️ CRITICAL: High-risk indicators [${kwStr}] detected. Immediate response required. SLA: ${sla}h.`,
    MEDIUM: `⚡ MODERATE: Prompt attention needed [${kwStr}]. Routed to ${category}. SLA: ${sla}h.`,
    LOW:    `ℹ️ STANDARD: Routine issue [${kwStr}]. Queued for ${category}. SLA: ${sla}h.`
  }[priority];

  return { category, priority, reasoning, confidence: parseFloat(Math.min(0.50 + maxScore * 0.08, 0.92).toFixed(2)), subcategory: null, keywords_detected: kws };
}

// ─── SSE BROADCAST ───────────────────────────────────────────────────────────
function broadcast(type, data) {
  const payload = `data: ${JSON.stringify({ type, ...data, ts: Date.now() })}\n\n`;
  db.sseClients = db.sseClients.filter(c => { try { c.res.write(payload); return true; } catch { return false; } });
}

// ─── CREATE ALERT ─────────────────────────────────────────────────────────────
function createAlert(type, message, priority, meta = {}) {
  const alert = { id: `ALT-${String(alertCounter++).padStart(4,'0')}`, type, message, priority, timestamp: new Date().toISOString(), read: false, ...meta };
  db.alerts.unshift(alert);
  if (db.alerts.length > 300) db.alerts = db.alerts.slice(0, 300);
  broadcast('alert', { alert });
  return alert;
}

// ─── EMAIL TEMPLATE ──────────────────────────────────────────────────────────
function emailTpl({ title, subtitle, color, rows, extra }) {
  const rowsHtml = rows.map((r, i) => `<tr style="background:${i%2===0?'#f9fafb':'white'}"><td style="padding:10px 16px;font-weight:600;color:#374151;width:38%;border-bottom:1px solid #e5e7eb">${r.label}</td><td style="padding:10px 16px;color:#111827;border-bottom:1px solid #e5e7eb">${r.value}</td></tr>`).join('');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:32px auto;padding:0 16px 32px">
  <div style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:28px 32px;border-radius:16px 16px 0 0;text-align:center">
    <div style="font-size:30px;font-weight:900;letter-spacing:-1px;color:white;font-family:'Helvetica Neue',Arial">${CONFIG.BRAND}</div>
    <div style="color:#94a3b8;font-size:13px;margin-top:4px">${CONFIG.BRAND_TAGLINE}</div>
  </div>
  <div style="background:white;border-radius:0 0 16px 16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">
    <div style="background:${color};padding:18px 28px"><div style="font-size:19px;font-weight:700;color:white">${title}</div><div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:3px">${subtitle}</div></div>
    <div style="padding:24px 28px"><table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">${rowsHtml}</table>${extra ? `<div style="margin-top:20px">${extra}</div>` : ''}</div>
    <div style="padding:14px 28px 22px;color:#9ca3af;font-size:12px;text-align:center;border-top:1px solid #f3f4f6">© ${new Date().getFullYear()} ${CONFIG.BRAND} — ${CONFIG.BRAND_CITY}</div>
  </div>
</div></body></html>`;
}

async function sendMail(to, subject, html) {
  if (!CONFIG.EMAIL_ENABLED || !mailer || !to) return false;
  try { await mailer.sendMail({ from: `"${CONFIG.BRAND}" <${CONFIG.EMAIL_FROM}>`, to, subject, html }); return true; }
  catch (e) { console.error('[EMAIL]', e.message); return false; }
}

async function sendWA(body) {
  if (!CONFIG.WHATSAPP_ENABLED) { console.log('[WA] Disabled in config'); return false; }
  if (!twilio) { console.log('[WA] Twilio client not initialized'); return false; }
  try {
    const msg = await twilio.messages.create({ from: CONFIG.WHATSAPP_FROM, to: CONFIG.WHATSAPP_TO, body });
    console.log('[WA] ✅ Sent — SID: ' + msg.sid + ' | Status: ' + msg.status);
    return true;
  } catch (e) {
    console.error('[WA] ❌ FAILED');
    console.error('    Code:    ' + e.code);
    console.error('    Status:  ' + e.status);
    console.error('    Message: ' + e.message);
    console.error('    More:    ' + (e.moreInfo || 'N/A'));
    return false;
  }
}

// ─── NOTIFY: NEW COMPLAINT ────────────────────────────────────────────────────
async function notifyNew(complaint) {
  const pe   = complaint.priority === 'HIGH' ? '🚨' : complaint.priority === 'MEDIUM' ? '⚠️' : 'ℹ️';
  const loc  = complaint.location?.area || complaint.location?.address || 'Unknown';
  const ll   = (complaint.location?.lat && complaint.location?.lon) ? `${parseFloat(complaint.location.lat).toFixed(5)}, ${parseFloat(complaint.location.lon).toFixed(5)}` : 'N/A';
  const clr  = complaint.priority === 'HIGH' ? '#dc2626' : complaint.priority === 'MEDIUM' ? '#d97706' : '#16a34a';

  const waMsg = `${pe} NEW COMPLAINT — ${CONFIG.BRAND}\n\n📋 ID: ${complaint.id}\n🏷️ Category: ${complaint.category}\n⚠️ Priority: ${complaint.priority}\n📝 ${complaint.text.substring(0,200)}\n📍 ${loc}\n🗺️ Coords: ${ll}\n👤 ${complaint.contactEmail || complaint.contactPhone || 'No contact'}\n🕐 ${new Date().toLocaleString('en-IN')}`;
  const waSent = await sendWA(waMsg);
  db.notifications.push({ channel: 'whatsapp', complaintId: complaint.id, to: CONFIG.WHATSAPP_TO, message: waMsg, timestamp: new Date().toISOString(), status: waSent ? 'sent' : 'simulated', type: 'new_complaint' });

  if (complaint.contactEmail) {
    const html = emailTpl({
      title: `${pe} Complaint Registered`, subtitle: `ID: ${complaint.id}`, color: clr,
      rows: [
        { label: 'Complaint ID', value: `<strong style="font-family:monospace;font-size:15px">${complaint.id}</strong>` },
        { label: 'Category',     value: complaint.category },
        { label: 'Priority',     value: `<span style="background:${clr};color:white;padding:2px 10px;border-radius:10px;font-size:12px">${complaint.priority}</span>` },
        { label: 'Description',  value: complaint.text },
        { label: 'Location',     value: loc },
        { label: 'Coordinates',  value: ll },
        { label: 'Submitted',    value: new Date().toLocaleString('en-IN') },
        { label: 'Assigned To',  value: db.departments[complaint.category]?.name || complaint.category },
        { label: 'AI Analysis',  value: complaint.reasoning },
      ],
      extra: `<div style="background:#eff6ff;border:1px solid #bfdbfe;padding:14px;border-radius:8px;color:#1e40af;font-size:13px">💡 Track your complaint using ID <strong>${complaint.id}</strong> on the ${CONFIG.BRAND} portal anytime.</div>`
    });
    const sent = await sendMail(complaint.contactEmail, `${pe} [${complaint.id}] Complaint Registered — ${CONFIG.BRAND}`, html);
    db.notifications.push({ channel: 'email', complaintId: complaint.id, to: complaint.contactEmail, subject: 'Complaint Registered', timestamp: new Date().toISOString(), status: sent ? 'sent' : 'failed', type: 'new_complaint' });
  }
  broadcast('new_complaint', { id: complaint.id, category: complaint.category, priority: complaint.priority, text: complaint.text.substring(0, 100), location: loc });
}

// ─── NOTIFY: STATUS UPDATE ────────────────────────────────────────────────────
async function notifyStatus(complaint, oldS, newS, note, by) {
  const se  = newS === 'Resolved' ? '✅' : newS === 'In Progress' ? '🔄' : '📋';
  const clr = newS === 'Resolved' ? '#16a34a' : newS === 'In Progress' ? '#2563eb' : '#d97706';
  const loc = complaint.location?.area || complaint.location?.address || 'N/A';
  const ll  = (complaint.location?.lat && complaint.location?.lon) ? `${parseFloat(complaint.location.lat).toFixed(5)}, ${parseFloat(complaint.location.lon).toFixed(5)}` : 'N/A';

  const waMsg = `${se} STATUS UPDATE — ${CONFIG.BRAND}\n\n📋 ID: ${complaint.id}\n🏷️ ${complaint.category}\n📊 ${oldS} → ${newS}\n👤 By: ${by||'Admin'}\n📝 Note: ${note||'None'}\n🕐 ${new Date().toLocaleString('en-IN')}`;
  const waSent = await sendWA(waMsg);
  db.notifications.push({ channel: 'whatsapp', complaintId: complaint.id, to: CONFIG.WHATSAPP_TO, message: waMsg, timestamp: new Date().toISOString(), status: waSent ? 'sent' : 'simulated', type: 'status_update' });

  if (complaint.contactEmail) {
    const extra = newS === 'Resolved'
      ? `<div style="background:#dcfce7;color:#166534;padding:14px;border-radius:8px;text-align:center;font-weight:700">🎉 Your complaint has been resolved! Thank you for using ${CONFIG.BRAND}.</div>`
      : `<div style="background:#eff6ff;color:#1e40af;padding:12px;border-radius:8px;font-size:13px">🔔 Our team is actively working on your issue. You'll be notified of updates.</div>`;
    const html = emailTpl({
      title: `${se} Status Updated: ${newS}`, subtitle: `Complaint ${complaint.id}`, color: clr,
      rows: [
        { label: 'Complaint ID',    value: `<strong style="font-family:monospace">${complaint.id}</strong>` },
        { label: 'Category',        value: complaint.category },
        { label: 'Previous Status', value: `<span style="color:#6b7280">${oldS}</span>` },
        { label: 'New Status',      value: `<span style="background:${clr};color:white;padding:2px 10px;border-radius:10px;font-size:12px">${newS}</span>` },
        { label: 'Updated By',      value: by || 'Admin' },
        { label: 'Note',            value: note || 'No additional note' },
        { label: 'Location',        value: loc },
        { label: 'Coordinates',     value: ll },
        { label: 'Updated At',      value: new Date().toLocaleString('en-IN') },
      ],
      extra
    });
    const sent = await sendMail(complaint.contactEmail, `${se} [${complaint.id}] Status Updated to ${newS} — ${CONFIG.BRAND}`, html);
    db.notifications.push({ channel: 'email', complaintId: complaint.id, to: complaint.contactEmail, subject: `Status: ${newS}`, timestamp: new Date().toISOString(), status: sent ? 'sent' : 'failed', type: 'status_update' });
  }
  broadcast('status_update', { complaintId: complaint.id, oldStatus: oldS, newStatus: newS });
}

// ─── NOTIFY: DISASTER ────────────────────────────────────────────────────────
async function notifyDisaster(disaster) {
  broadcast('disaster', { disaster: { id: disaster.id, type: disaster.type, severity: disaster.severity, location: disaster.location, description: disaster.description } });
  const uniqueEmails = [...new Set(db.complaints.filter(c => c.contactEmail).map(c => c.contactEmail))];
  const ll = disaster.coordinates ? `${disaster.coordinates.lat.toFixed(4)}, ${disaster.coordinates.lon.toFixed(4)}` : 'N/A';
  const html = emailTpl({
    title: `🚨 ${disaster.severity} DISASTER ALERT`, subtitle: `${disaster.type} — ${disaster.location}`, color: '#dc2626',
    rows: [
      { label: 'Type',        value: `<strong>${disaster.type}</strong>` },
      { label: 'Severity',    value: `<span style="background:#dc2626;color:white;padding:2px 10px;border-radius:10px;font-size:12px">${disaster.severity}</span>` },
      { label: 'Location',    value: disaster.location },
      { label: 'Coordinates', value: ll },
      { label: 'Details',     value: disaster.description },
      { label: 'Source',      value: disaster.source || 'Monitoring System' },
      { label: 'Detected',    value: new Date().toLocaleString('en-IN') },
    ],
    extra: `<div style="background:#fef2f2;border:1px solid #fecaca;padding:14px;border-radius:8px;color:#991b1b;font-size:13px;font-weight:600">⚠️ Follow official safety instructions. Stay indoors if advised. Contact emergency services if needed.</div>`
  });
  for (const email of uniqueEmails.slice(0, 50)) {
    await sendMail(email, `🚨 [DISASTER ALERT] ${disaster.type} — ${disaster.location} | ${CONFIG.BRAND}`, html);
  }
  const waMsg = `🚨 ${disaster.severity} DISASTER — ${CONFIG.BRAND}\n\n🌍 ${disaster.type}\n📍 ${disaster.location}\n📋 ${disaster.description}\n🕐 ${new Date().toLocaleString('en-IN')}\n\nUsers notified: ${uniqueEmails.length}`;
  await sendWA(waMsg);
  db.notifications.push({ channel: 'disaster_alert', disasterId: disaster.id, to: uniqueEmails.length > 0 ? `${uniqueEmails.length} registered user(s)` : 'No users registered yet', location: disaster.location, usersNotified: uniqueEmails.length, timestamp: new Date().toISOString(), status: 'sent', type: 'disaster' });
}

// ─── DISASTER MONITORING ──────────────────────────────────────────────────────
async function fetchEarthquakes() {
  try {
    const res = await axios.get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', { timeout: 10000 });
    for (const f of (res.data.features || [])) {
      const [lon, lat] = f.geometry.coordinates;
      // Strict India bounding box — lon >= 72 excludes Afghanistan/Pakistan
      if (lat < 6 || lat > 35.5 || lon < 72 || lon > 97.5) continue;
      const srcId = `EQ-${f.id}`;
      if (db.disasters.find(d => d.sourceId === srcId)) continue;
      const mag = f.properties.mag;
      const place = f.properties.place || 'India region';
      const sev = mag >= 6 ? 'CRITICAL' : mag >= 4.5 ? 'HIGH' : mag >= 3 ? 'MEDIUM' : 'LOW';
      const disaster = {
        id: `DIS-${uuidv4().substring(0,8)}`, sourceId: srcId, type: 'Earthquake',
        subtype: mag >= 5 ? 'Major Earthquake' : 'Minor Earthquake',
        location: place, severity: sev, magnitude: mag,
        coordinates: { lat, lon }, time: new Date(f.properties.time).toISOString(),
        fetchedAt: new Date().toISOString(),
        description: `Magnitude ${mag} earthquake near ${place}`,
        source: 'USGS', actionRequired: sev === 'CRITICAL' || sev === 'HIGH'
      };
      db.disasters.unshift(disaster);
      createAlert('disaster', `🌍 EARTHQUAKE M${mag}: ${place}`, sev, { disasterId: disaster.id, location: place });
      if (sev === 'CRITICAL' || sev === 'HIGH') notifyDisaster(disaster).catch(console.error);
    }
    if (db.disasters.length > 100) db.disasters = db.disasters.slice(0, 100);
  } catch (e) { console.warn('[USGS]', e.message); }
}

async function fetchWeather() {
  const cities = [
    { name: 'Hyderabad', lat: 17.385,  lon: 78.4867 },
    { name: 'Warangal',  lat: 17.9784, lon: 79.5941 },
    { name: 'Nizamabad', lat: 18.6725, lon: 78.0941 },
    { name: 'Karimnagar',lat: 18.4392, lon: 79.1288 },
    { name: 'Khammam',   lat: 17.2473, lon: 80.1514 },
  ];
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) return;
  for (const city of cities) {
    try {
      const r = await axios.get(`https://api.openweathermap.org/data/2.5/weather?lat=${city.lat}&lon=${city.lon}&appid=${key}&units=metric`, { timeout: 5000 });
      const d = r.data, wid = d.weather[0].id, temp = d.main.temp, wind = d.wind?.speed || 0;
      const severe = (wid >= 200 && wid < 300) || (wid >= 500 && wid < 510 && (d.rain?.['1h']||0) > 50) || wid === 781 || temp > 45 || wind > 20;
      if (!severe) continue;
      const sid = `WX-${city.name}-${wid}-${new Date().toDateString()}`;
      if (db.disasters.find(x => x.sourceId === sid)) continue;
      const sev = (wid >= 200 && wid < 300) || wid === 781 ? 'CRITICAL' : 'HIGH';
      const disaster = {
        id: `DIS-${uuidv4().substring(0,8)}`, sourceId: sid, type: 'Weather',
        subtype: d.weather[0].main, location: `${city.name}, Telangana`, severity: sev,
        temperature: temp, windSpeed: wind, humidity: d.main.humidity,
        coordinates: { lat: city.lat, lon: city.lon }, time: new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
        description: `Severe ${d.weather[0].description} in ${city.name}. Temp: ${temp}°C, Wind: ${wind} m/s`,
        source: 'OpenWeatherMap', actionRequired: true
      };
      db.disasters.unshift(disaster);
      createAlert('disaster', `🌩️ WEATHER: ${d.weather[0].main} in ${city.name}`, sev, { disasterId: disaster.id });
      notifyDisaster(disaster).catch(console.error);
    } catch { /* skip */ }
  }
}

async function monitorDisasters() {
  console.log(`[MONITOR] Fetching disaster data (${new Date().toLocaleTimeString('en-IN')})...`);
  await Promise.allSettled([fetchEarthquakes(), fetchWeather()]);
}

// ─── SAMPLE DISASTER (for demo purposes) ─────────────────────────────────────
function injectSampleDisaster() {
  const sampleId = 'SAMPLE-HYDERABAD-FLOOD';
  if (db.disasters.find(d => d.sourceId === sampleId)) return; // don't duplicate

  const sample = {
    id:          `DIS-SAMPLE-001`,
    sourceId:    sampleId,
    type:        'Flood',
    subtype:     'Urban Flooding',
    location:    'Hyderabad, Telangana',
    severity:    'HIGH',
    coordinates: { lat: 17.3850, lon: 78.4867 },
    time:        new Date().toISOString(),
    fetchedAt:   new Date().toISOString(),
    description: 'Severe urban flooding reported across low-lying areas of Hyderabad due to heavy overnight rainfall. Multiple roads waterlogged. Rescue operations underway.',
    affectedAreas: ['Begumpet', 'Secunderabad', 'LB Nagar', 'Uppal'],
    source:      'Civix Demo — Sample Alert',
    actionRequired: true,
    isSample:    true
  };

  db.disasters.unshift(sample);
  createAlert('disaster', '🌊 FLOOD ALERT: Urban flooding in Hyderabad, Telangana — HIGH severity', 'HIGH', {
    disasterId: sample.id,
    location: sample.location
  });
  console.log('[DEMO] ✅ Sample disaster injected — Hyderabad Flood');
}

injectSampleDisaster();
monitorDisasters();
setInterval(monitorDisasters, CONFIG.DISASTER_INTERVAL_MS);

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// SSE real-time stream
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const client = { id: uuidv4(), res };
  db.sseClients.push(client);
  res.write(`data: ${JSON.stringify({ type: 'connected', clientId: client.id })}\n\n`);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { clearInterval(ping); } }, 20000);
  req.on('close', () => { clearInterval(ping); db.sseClients = db.sseClients.filter(c => c.id !== client.id); });
});

// Auth
app.post('/api/auth/login', (req, res) => {
  const u = ADMINS[req.body.username?.toLowerCase()];
  if (!u || u.password !== req.body.password) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ success: true, username: req.body.username, role: u.role, department: u.department });
});

// Submit complaint
app.post('/api/complaint', async (req, res) => {
  const { text, location, contactEmail, contactPhone, photos } = req.body;
  if (!text || text.trim().length < 10) return res.status(400).json({ error: 'Complaint must be at least 10 characters.' });
  const dup = db.complaints.find(c => c.text === text.trim() && Date.now() - new Date(c.timestamp).getTime() < 10000);
  if (dup) return res.json({ success: true, complaint: dup, duplicate: true });

  let ai;
  try { const r = await axios.post(`${CONFIG.AI_URL}/classify`, { text }, { timeout: 4000 }); ai = r.data; }
  catch { ai = classify(text); }

  const complaint = {
    id: `ID-${idCounter++}`, text: text.trim(),
    category: ai.category, priority: ai.priority, reasoning: ai.reasoning,
    confidence: ai.confidence || 0.85, subcategory: ai.subcategory || null,
    department: db.departments[ai.category]?.name || 'General Services',
    status: 'Pending', location: location || null,
    contactEmail: contactEmail || null, contactPhone: contactPhone || null,
    timestamp: new Date().toISOString(), updates: [], upvotes: 0,
    photos: Array.isArray(photos) ? photos.slice(0,3).map(p => ({ name: p.name, data: p.data, type: p.type })) : [],
  };

  db.complaints.unshift(complaint);
  if (db.departments[ai.category]) db.departments[ai.category].count++;
  scheduleSave(); // persist to disk immediately

  const em = complaint.priority === 'HIGH' ? '🚨' : complaint.priority === 'MEDIUM' ? '⚠️' : 'ℹ️';
  createAlert('complaint', `${em} ${complaint.priority}: ${complaint.category} — ${complaint.text.substring(0,100)}`, complaint.priority, { complaintId: complaint.id });
  notifyNew(complaint).catch(console.error);

  res.json({ success: true, complaint });
});

// Get complaints
app.get('/api/complaints', (req, res) => {
  const { priority, category, status, search } = req.query;
  let r = [...db.complaints];
  if (priority) r = r.filter(c => c.priority === priority.toUpperCase());
  if (category) r = r.filter(c => c.category === category);
  if (status)   r = r.filter(c => c.status === status);
  if (search)   r = r.filter(c => c.text.toLowerCase().includes(search.toLowerCase()) || c.id.toLowerCase().includes(search.toLowerCase()));
  res.json({ complaints: r, total: r.length });
});

// Single complaint
app.get('/api/complaints/id/:id', (req, res) => {
  const c = db.complaints.find(c => c.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});

// By department
app.get('/api/complaints/department/:dept', (req, res) => {
  const dept = decodeURIComponent(req.params.dept);
  const r = db.complaints.filter(c => c.category === dept || c.department === dept);
  res.json({ complaints: r, total: r.length });
});

// Update status / reassign / priority override
app.put('/api/complaint/:id', async (req, res) => {
  const { status, note, assignedTo, category, priority, internalNote } = req.body;
  const c = db.complaints.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });

  const oldS    = c.status;
  const oldCat  = c.category;
  const oldPrio = c.priority;

  if (status)   c.status   = status;
  if (assignedTo) c.assignedTo = assignedTo;

  // Reassign department
  if (category && category !== oldCat) {
    c.category   = category;
    c.department = db.departments[category]?.name || category;
    createAlert('system', `🔄 ${c.id} reassigned: ${oldCat} → ${category}`, 'LOW', { complaintId: c.id });
  }

  // Priority override
  if (priority && priority !== oldPrio) {
    c.priority = priority;
    const pEmoji = priority === 'HIGH' ? '🚨' : priority === 'MEDIUM' ? '⚠️' : 'ℹ️';
    createAlert('system', `${pEmoji} ${c.id} priority changed: ${oldPrio} → ${priority}`, priority, { complaintId: c.id });
  }

  // Internal admin note (not sent to citizen)
  if (internalNote) {
    if (!c.internalNotes) c.internalNotes = [];
    c.internalNotes.push({ note: internalNote, by: assignedTo || 'Admin', timestamp: new Date().toISOString() });
  }

  // Status update log
  if (status || note) {
    c.updates.push({
      status: status || c.status,
      note: note || (category ? `Reassigned to ${category}` : priority ? `Priority changed to ${priority}` : `Updated`),
      timestamp: new Date().toISOString(),
      updatedBy: assignedTo || 'Admin'
    });
  }

  if (status === 'Resolved') createAlert('system', `✅ ${c.id} resolved by ${assignedTo || 'Admin'}`, 'LOW', { complaintId: c.id });
  if (status && status !== oldS) notifyStatus(c, oldS, status, note, assignedTo).catch(console.error);
  scheduleSave(); // persist all changes

  res.json({ success: true, complaint: c });
});

// Citizen feedback (thumbs up/down after resolved)
app.post('/api/complaint/:id/feedback', (req, res) => {
  const { rating, comment } = req.body; // rating: 'satisfied' | 'unsatisfied'
  const c = db.complaints.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.status !== 'Resolved') return res.status(400).json({ error: 'Feedback only allowed after resolution' });
  if (c.feedback) return res.status(400).json({ error: 'Feedback already submitted' });
  c.feedback = { rating, comment: comment || '', timestamp: new Date().toISOString() };
  createAlert('system', `${rating === 'satisfied' ? '😊' : '😞'} Feedback on ${c.id}: ${rating}`, 'LOW', { complaintId: c.id });
  scheduleSave(); // persist feedback
  res.json({ success: true });
});

// Export complaints as CSV
app.get('/api/complaints/export', (req, res) => {
  const { category, priority, status } = req.query;
  let data = [...db.complaints];
  if (category) data = data.filter(c => c.category === category);
  if (priority) data = data.filter(c => c.priority === priority);
  if (status)   data = data.filter(c => c.status === status);

  const headers = ['ID','Category','Priority','Status','Description','Location','Latitude','Longitude','Contact Email','Contact Phone','Department','Assigned To','Filed At','Feedback'];
  const rows = data.map(c => [
    c.id, c.category, c.priority, c.status,
    `"${(c.text || '').replace(/"/g, "'")}"`,
    c.location?.area || '',
    c.location?.lat || '', c.location?.lon || '',
    c.contactEmail || '', c.contactPhone || '',
    c.department || '', c.assignedTo || '',
    new Date(c.timestamp).toLocaleString('en-IN'),
    c.feedback ? c.feedback.rating : 'No feedback'
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="civix-complaints-${Date.now()}.csv"`);
  res.send(csv);
});

// Upvote
app.post('/api/complaint/:id/upvote', (req, res) => {
  const c = db.complaints.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  c.upvotes = (c.upvotes || 0) + 1;
  res.json({ success: true, upvotes: c.upvotes });
});

// Alerts
app.get('/api/alerts', (req, res) => {
  const { type, priority, unread, department } = req.query;
  let r = [...db.alerts];
  if (type)       r = r.filter(a => a.type === type);
  if (priority)   r = r.filter(a => a.priority === priority.toUpperCase());
  if (unread === 'true') r = r.filter(a => !a.read);
  if (department) {
    const ids = new Set(db.complaints.filter(c => c.category === department).map(c => c.id));
    r = r.filter(a => !a.complaintId || ids.has(a.complaintId) || a.type === 'disaster');
  }
  res.json({ alerts: r, total: r.length, unread: db.alerts.filter(a => !a.read).length });
});

app.put('/api/alerts/:id/read', (req, res) => {
  const a = db.alerts.find(x => x.id === req.params.id);
  if (a) { a.read = true; scheduleSave(); }
  res.json({ success: true });
});

app.put('/api/alerts/read-all', (req, res) => {
  db.alerts.forEach(a => a.read = true);
  broadcast('alerts_cleared', {});
  scheduleSave();
  res.json({ success: true });
});

// Disasters
app.get('/api/disasters', (req, res) => {
  const { type, severity } = req.query;
  let r = [...db.disasters];
  if (type)     r = r.filter(d => d.type === type);
  if (severity) r = r.filter(d => d.severity === severity.toUpperCase());
  res.json({ disasters: r, total: r.length });
});

// Departments
app.get('/api/departments', (req, res) => {
  const out = {};
  for (const [k, dept] of Object.entries(db.departments)) {
    const dc = db.complaints.filter(c => c.category === k);
    out[k] = { ...dept, total: dc.length, pending: dc.filter(c => c.status==='Pending').length, inProgress: dc.filter(c => c.status==='In Progress').length, resolved: dc.filter(c => c.status==='Resolved').length, highPriority: dc.filter(c => c.priority==='HIGH').length };
  }
  res.json(out);
});

// Analytics
app.get('/api/analytics', (req, res) => {
  const C = db.complaints, now = Date.now(), dayMs = 86400000;
  const cat = {}, pri = { HIGH:0, MEDIUM:0, LOW:0 }, sta = { Pending:0, 'In Progress':0, Resolved:0 }, area = {}, hourly = new Array(24).fill(0), daily = {}, dept = {};
  C.forEach(c => {
    cat[c.category] = (cat[c.category]||0)+1;
    if (pri[c.priority]!==undefined) pri[c.priority]++;
    if (sta[c.status]!==undefined)   sta[c.status]++;
    if (c.location?.area) area[c.location.area] = (area[c.location.area]||0)+1;
    hourly[new Date(c.timestamp).getHours()]++;
    const day = new Date(c.timestamp).toLocaleDateString('en-IN');
    daily[day] = (daily[day]||0)+1;
    dept[c.category] = (dept[c.category]||0)+1;
  });
  const last7 = Array.from({length:7},(_,i)=>{ const d = new Date(now-(6-i)*dayMs); const k = d.toLocaleDateString('en-IN'); return { date:k, count:daily[k]||0 }; });
  const resTimes = C.filter(c=>c.status==='Resolved').map(c=>{ const u=c.updates.find(x=>x.status==='Resolved'); return u?(new Date(u.timestamp)-new Date(c.timestamp))/3600000:null; }).filter(Boolean);
  res.json({ total:C.length, categoryCount:cat, priorityCount:pri, statusCount:sta, areaCount:area, hourlyCount:hourly, dailyTrend:last7, deptLoad:dept, avgResolutionHours:resTimes.length?(resTimes.reduce((a,b)=>a+b,0)/resTimes.length).toFixed(1):'N/A', disasterCount:db.disasters.length, alertCount:db.alerts.length });
});

// Stats
app.get('/api/stats', (req, res) => {
  res.json({ totalComplaints:db.complaints.length, pending:db.complaints.filter(c=>c.status==='Pending').length, inProgress:db.complaints.filter(c=>c.status==='In Progress').length, resolved:db.complaints.filter(c=>c.status==='Resolved').length, highPriority:db.complaints.filter(c=>c.priority==='HIGH').length, activeDisasters:db.disasters.filter(d=>d.actionRequired).length, unreadAlerts:db.alerts.filter(a=>!a.read).length, totalAlerts:db.alerts.length, connectedClients:db.sseClients.length });
});

// Notifications
app.get('/api/notifications', (req, res) => {
  res.json({ notifications: db.notifications.slice(0,100), total: db.notifications.length });
});

// Manual Alert — Super Admin sends emergency notification to all users
app.post('/api/alerts/manual', async (req, res) => {
  const { type, severity, location, message, instructions, sentBy } = req.body;
  if (!message || !location) return res.status(400).json({ error: 'Message and location required' });

  // Build the disaster object and add to db
  const disaster = {
    id:          `DIS-MANUAL-${Date.now()}`,
    sourceId:    `MANUAL-${Date.now()}`,
    type:        type || 'Emergency',
    subtype:     'Manual Alert',
    location,
    severity:    severity || 'HIGH',
    coordinates: null,
    time:        new Date().toISOString(),
    fetchedAt:   new Date().toISOString(),
    description: message,
    source:      `Manual — ${sentBy || 'Super Admin'}`,
    actionRequired: true,
    isManual:    true
  };
  db.disasters.unshift(disaster);

  // Create alert in system
  const sev = severity || 'HIGH';
  const icon = sev === 'CRITICAL' ? '🚨' : '⚠️';
  createAlert('disaster', `${icon} MANUAL ALERT: ${type} in ${location}`, sev, { disasterId: disaster.id, location });

  // WhatsApp to admin
  const safetyLine = instructions ? ('\n\nSafety: ' + instructions) : '';
  const waMsg = icon + ' EMERGENCY ALERT — ' + CONFIG.BRAND + '\n\n' +
    'Sent by: ' + (sentBy || 'Super Admin') + '\n' +
    'Type: ' + type + '\n' +
    'Location: ' + location + '\n' +
    'Severity: ' + sev + '\n\n' +
    message + safetyLine + '\n\n' +
    new Date().toLocaleString('en-IN');
  await sendWA(waMsg);

  // Email to all registered users
  const uniqueEmails = [...new Set(db.complaints.filter(c => c.contactEmail).map(c => c.contactEmail))];
  const html = emailTpl({
    title:    `${icon} Emergency Alert: ${type}`,
    subtitle: `Issued by ${sentBy || 'Super Admin'} — ${location}`,
    color:    sev === 'CRITICAL' ? '#7f1d1d' : '#991b1b',
    rows: [
      { label: 'Alert Type',  value: `<strong>${type}</strong>` },
      { label: 'Severity',    value: `<span style="background:#dc2626;color:white;padding:2px 10px;border-radius:10px;font-size:12px">${sev}</span>` },
      { label: 'Location',    value: location },
      { label: 'Message',     value: message },
      { label: 'Issued By',   value: sentBy || 'Super Admin' },
      { label: 'Issued At',   value: new Date().toLocaleString('en-IN') },
      ...(instructions ? [{ label: 'Safety Instructions', value: `<strong>${instructions}</strong>` }] : [])
    ],
    extra: `<div style="background:#fef2f2;border:1px solid #fecaca;padding:14px;border-radius:8px;color:#991b1b;font-weight:600;font-size:13px">
      ⚠️ This is an official emergency alert from ${CONFIG.BRAND}. Please follow all safety instructions immediately.
    </div>`
  });

  let emailsSent = 0;
  for (const email of uniqueEmails.slice(0, 100)) {
    const sent = await sendMail(email, `${icon} [EMERGENCY ALERT] ${type} — ${location} | ${CONFIG.BRAND}`, html);
    if (sent) emailsSent++;
  }

  db.notifications.push({
    channel: 'manual_alert', disasterId: disaster.id,
    to: uniqueEmails.length > 0 ? `${emailsSent} user(s)` : 'No users registered',
    location, sentBy: sentBy || 'Super Admin',
    timestamp: new Date().toISOString(), status: 'sent', type: 'manual_alert'
  });

  console.log(`[MANUAL ALERT] ✅ Sent by ${sentBy} — ${type} in ${location} — ${emailsSent} emails dispatched`);
  res.json({ success: true, emailsSent, disasterId: disaster.id });
});

// Training Data — serves the 455 sample complaints to admin frontend
app.get('/api/training-data', (req, res) => {
  try {
    const filePath = require('path').join(__dirname, '..', 'ai-service', 'training_data.json');
    if (!require('fs').existsSync(filePath)) {
      return res.json({ samples: [], total: 0, message: 'training_data.json not found in ai-service folder' });
    }
    const samples = JSON.parse(require('fs').readFileSync(filePath, 'utf8'));
    const { category, priority, search } = req.query;
    let filtered = samples;
    if (category) filtered = filtered.filter(s => s.expected_category === category);
    if (priority) filtered = filtered.filter(s => s.expected_priority === priority);
    if (search)   filtered = filtered.filter(s => s.text.toLowerCase().includes(search.toLowerCase()));
    res.json({ samples: filtered, total: samples.length, filtered: filtered.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── BULK STATUS UPDATE (Feature 9) ─────────────────────────────────────────
app.put('/api/complaints/bulk', async (req, res) => {
  const { ids, status, note, assignedTo } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });
  let updated = 0;
  for (const id of ids) {
    const c = db.complaints.find(x => x.id === id);
    if (!c) continue;
    const oldS = c.status;
    if (status) c.status = status;
    if (assignedTo) c.assignedTo = assignedTo;
    c.updates.push({ status: status || c.status, note: note || 'Bulk update', timestamp: new Date().toISOString(), updatedBy: assignedTo || 'Admin' });
    if (status === 'Resolved') createAlert('system', `✅ ${c.id} bulk-resolved`, 'LOW', { complaintId: c.id });
    if (status && status !== oldS) notifyStatus(c, oldS, status, note || 'Bulk update', assignedTo || 'Admin').catch(console.error);
    updated++;
  }
  scheduleSave();
  res.json({ success: true, updated });
});

// ─── AUTO-ESCALATION (Feature 8) — check on server tick ──────────────────────
function runAutoEscalation() {
  const SLA_MS = { HIGH: 3600000, MEDIUM: 86400000, LOW: 259200000 }; // 1h, 24h, 72h
  const now = Date.now();
  db.complaints.forEach(c => {
    if (c.status !== 'Pending' && c.status !== 'Escalated') return;
    if (c.status === 'Escalated') return;
    const sla = SLA_MS[c.priority] || SLA_MS.LOW;
    const elapsed = now - new Date(c.timestamp).getTime();
    if (elapsed >= sla) {
      c.status = 'Escalated';
      c.updates.push({ status: 'Escalated', note: `Auto-escalated: ${c.priority} priority SLA exceeded`, timestamp: new Date().toISOString(), updatedBy: 'System' });
      createAlert('system', `⚠️ AUTO-ESCALATED: ${c.id} (${c.category}) — ${c.priority} SLA breached`, 'HIGH', { complaintId: c.id });
      // Send WA alert
      const msg = `⚠️ ESCALATION ALERT — ${CONFIG.BRAND}\n\n📋 ID: ${c.id}\n🏷️ ${c.category}\n⚠️ ${c.priority} priority complaint UNRESOLVED past SLA\n📝 ${c.text.substring(0,100)}\n🕐 ${new Date().toLocaleString('en-IN')}\n\nImmediate action required.`;
      sendWA(msg).catch(console.error);
      console.log(`[ESCALATE] ⚠️ ${c.id} auto-escalated (${c.priority} SLA breached)`);
      scheduleSave();
    }
  });
}
// Run escalation check every 5 minutes
setInterval(runAutoEscalation, 300000);
runAutoEscalation(); // run once on startup

// Health
app.get('/health', (req, res) => res.json({ status:'ok', brand:CONFIG.BRAND, timestamp:new Date().toISOString(), complaints:db.complaints.length }));

// ─── START ────────────────────────────────────────────────────────────────────
// Auto-save every 2 minutes as backup
setInterval(saveData, 120000);

// Save on graceful shutdown (Ctrl+C)
process.on('SIGINT',  () => { saveData(); console.log('\n[DB] Data saved. Goodbye!'); process.exit(0); });
process.on('SIGTERM', () => { saveData(); process.exit(0); });

app.listen(CONFIG.PORT, () => {
  console.log(`\n  [${CONFIG.BRAND}] Backend running on http://localhost:${CONFIG.PORT}`);
  console.log(`  [DB]  Data file: ${DATA_FILE}`);
  console.log(`  [DB]  ${db.complaints.length} complaints loaded from previous session\n`);
});
