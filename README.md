# 🏛️ Civix — AI Civic Intelligence Platform

## 📁 Project Structure

```
D:\\\\civic-platform\\\\
│
├── backend\\\\
│   ├── server.js           ← Node.js + Express API server (port 3000)
│   ├── package.json        ← Dependencies list
│   ├── data.json           ← Auto-created on first run (persistent storage)
│   └── .env                ← Optional environment variables
│
├── ai-service\\\\
│   ├── main.py             ← Python FastAPI AI classifier (port 8000)
│   ├── requirements.txt    ← Python dependencies
│   └── training\\\_data.json  ← 455 labelled training complaints
│
├── frontend-user\\\\
│   └── index.html          ← Citizen portal (submit, track, disasters)
│
├── frontend-admin\\\\
│   └── index.html          ← Admin dashboard (manage, analytics, alerts)
│
├── README.md               ← This file
└── .gitignore
```

\---

## 🚀 How to Run

### Step 1 — Start the Backend

Open **Terminal 1** in `D:\\\\civic-platform\\\\backend\\\\`

```bash
npm install
node server.js
```

You should see:

```
\\\[TWILIO] OK
\\\[DB] Next complaint ID: ID-1
\\\[Civix] http://localhost:3000
\\\[DEMO] Sample disaster injected
```

### Step 2 — Start the AI Service (Optional)

Open **Terminal 2** in `D:\\\\civic-platform\\\\ai-service\\\\`

```bash
pip install -r requirements.txt
python main.py
```

> ✅ If Python is not installed, the backend has a built-in fallback classifier. Everything still works.

### Step 3 — Open the Frontend

Just open these HTML files directly in your browser — no server needed:

|Page|File|
|-|-|
|**Citizen Portal**|`frontend-user\\\\index.html`|
|**Admin Dashboard**|`frontend-admin\\\\index.html`|

\---

## 🔐 Admin Login Credentials

|Username|Password|Access Level|
|-|-|-|
|`admin`|`admin@123`|👑 Super Admin — all departments|
|`fire`|`fire@123`|🔥 Fire Department only|
|`medical`|`medical@123`|🏥 Medical Emergency only|
|`water`|`water@123`|💧 Water Authority only|
|`electricity`|`electric@123`|⚡ Electricity Board only|
|`police`|`police@123`|👮 Police Department only|
|`infrastructure`|`infra@123`|🏗️ PWD / Roads only|
|`sanitation`|`sanitation@123`|🗑️ Municipal Corporation only|

> Department logins only see their own department's complaints and alerts.
> Login session is saved in browser — no need to login again on refresh.

\---

## ✅ Features

### Citizen Portal (User)

|Feature|Description|
|-|-|
|**Submit Complaint**|File civic issues with AI auto-classification|
|**Smart Suggestions**|Real-time search suggestions while typing|
|**Duplicate Detection**|Warns if similar complaints already exist, option to upvote instead|
|**GPS Location**|Auto-detect location using browser GPS + Nominatim reverse geocoding|
|**Track Complaint**|Search by ID to see full status timeline|
|**SLA Progress Bar**|Visual countdown showing time remaining for resolution|
|**Citizen Feedback**|Rate your resolved complaint (Satisfied / Not Satisfied)|
|**Disaster Alerts**|View real-time earthquake and weather alerts|
|**Dark / Light Mode**|Toggle theme, persists across sessions|

### Admin Dashboard

|Feature|Description|
|-|-|
|**Login with Session**|Login persists until explicit logout|
|**Role-Based Access**|Department logins see only their data|
|**KPI Overview**|Total, High Priority, Resolved, Disasters, SLA Overdue, Escalated|
|**Analytics Charts**|Category pie, Priority bar, 7-day trend, Hourly distribution, Dept load|
|**Complaint Table**|ID, Issue, Category, Priority, Status, SLA countdown, Location, Actions|
|**SLA Tracking**|Color-coded countdown — Green (safe), Yellow (warning), Red (overdue)|
|**Auto-Escalation**|Overdue complaints auto-bumped to HIGH + WhatsApp alert every 5 minutes|
|**Update Status**|Change to In Progress / Resolved with officer name and note|
|**Reassign Department**|Fix AI misclassification — move to correct department|
|**Priority Override**|Manually change LOW/MEDIUM/HIGH|
|**Internal Notes**|Add admin-only notes (not sent to citizen)|
|**Bulk Status Update**|Select multiple complaints → resolve/start all at once|
|**Print Report**|Opens printer-friendly HTML report of all filtered complaints|
|**Export CSV**|Download complaints as spreadsheet|
|**Disaster Monitoring**|Real-time USGS earthquakes + OpenWeather, India/Telangana only|
|**Send Emergency Alert**|Super admin sends WhatsApp + email to all registered users|
|**Alert Users button**|On each disaster card — pre-fills the alert modal|
|**Training Data Tab**|View all 455 AI training samples with filters|
|**Live Notifications Bell**|Real-time SSE updates for new complaints, status changes, disasters|
|**Dark / Light Mode**|Charts re-render correctly on theme switch|

\---

## 📬 Notification System

### When a complaint is submitted:

* 📱 **WhatsApp** sent to admin `+91xxxxxxxxxx`
* 📧 **Email** sent to the citizen (if email was provided)
* 🔔 **SSE push** updates admin dashboard live

### When status is updated (Pending → In Progress → Resolved):

* 📱 **WhatsApp** sent to admin with before/after status
* 📧 **Email** sent to citizen with full update details + coordinates

### When a disaster is HIGH/CRITICAL severity:

* 📧 **Email** sent to ALL registered users (citizens who submitted with email)
* 📱 **WhatsApp** sent to admin with user count
* 🔔 **SSE push** to all connected browsers

### When admin sends manual emergency alert:

* 📱 **WhatsApp** to admin
* 📧 **Email** to all registered users

\---

## 🤖 AI Classification

### How it works:

1. Citizen types a complaint
2. Backend sends text to Python AI service (`localhost:8000/classify`)
3. If Python service is down → fallback classifier in `server.js` runs
4. Keywords scored for each of 8 departments using TF-IDF
5. Priority determined by emergency keywords (HIGH/MEDIUM/LOW)
6. SLA deadline calculated: HIGH=1h, MEDIUM=24h, LOW=72h

### Departments:

🔥 Fire | 🏥 Medical | 💧 Water | ⚡ Electricity | 👮 Police | 🏗️ Infrastructure | 🗑️ Sanitation | 📋 Other

### Training Data:

* 455 labelled complaints in `ai-service/training\\\_data.json`
* Covers all 8 departments with real Hyderabad-context examples
* Loaded on startup to expand classifier keyword vocabulary
* Visible in Admin → Complaints → 🧪 Training Data tab

\---

## 🌍 Disaster Monitoring

* **USGS Earthquake API** — fetched every 30 seconds
* **OpenWeather API** — fetched every 30 seconds (requires API key)
* **India bounding box** — lat 6–35.5, lon 72–97.5 (excludes Afghanistan/Pakistan)
* **Sample disaster** — Hyderabad urban flood pre-loaded for demo
* **Manual alerts** — Super admin can send custom emergency alerts

\---

## 💾 Data Persistence

All data saves to `backend/data.json` automatically:

* ✅ Saved immediately after every complaint submission
* ✅ Saved after every status update
* ✅ Saved after every feedback or note
* ✅ Auto-saved every 2 minutes as backup
* ✅ Saved cleanly on Ctrl+C shutdown
* ✅ Loaded on startup — continues from where it stopped
* ✅ Complaint IDs continue from last (ID-1, ID-2... never resets)

\---

## 🔧 Tech Stack

|Layer|Technology|
|-|-|
|**Frontend**|HTML5 + CSS3 + Vanilla JavaScript|
|**Charts**|Chart.js 4.4|
|**Icons**|Font Awesome 6.5|
|**Backend**|Node.js + Express.js|
|**Real-time**|Server-Sent Events (SSE)|
|**Email**|Nodemailer + Gmail SMTP|
|**WhatsApp**|Twilio WhatsApp Sandbox API|
|**AI Service**|Python + FastAPI + TF-IDF classifier|
|**External APIs**|USGS Earthquake Feed + OpenWeatherMap|
|**Storage**|JSON file (data.json) — no database needed|
|**Reverse Geocoding**|Nominatim (OpenStreetMap) — free, no API key|

## 

## 📋 API Reference

|Method|Endpoint|Description|
|-|-|-|
|`POST`|`/api/auth/login`|Admin login|
|`POST`|`/api/complaint`|Submit complaint|
|`GET`|`/api/complaints`|Get all complaints|
|`GET`|`/api/complaints/id/:id`|Get single complaint|
|`PUT`|`/api/complaint/:id`|Update status/reassign/note|
|`PUT`|`/api/complaints/bulk-update`|Bulk status update|
|`POST`|`/api/complaint/:id/feedback`|Citizen feedback|
|`POST`|`/api/complaint/:id/upvote`|Upvote complaint|
|`GET`|`/api/complaints/export`|Download as CSV|
|`GET`|`/api/complaints/suggestions`|Search suggestions|
|`POST`|`/api/complaints/check-similar`|Duplicate check|
|`GET`|`/api/alerts`|Get all alerts|
|`PUT`|`/api/alerts/:id/read`|Mark alert read|
|`PUT`|`/api/alerts/read-all`|Mark all read|
|`POST`|`/api/alerts/manual`|Send manual disaster alert|
|`GET`|`/api/disasters`|Get all disasters|
|`GET`|`/api/departments`|Department statistics|
|`GET`|`/api/analytics`|Full analytics data|
|`GET`|`/api/stats`|Quick dashboard stats|
|`GET`|`/api/notifications`|Notification history|
|`GET`|`/api/training-data`|AI training samples|
|`GET`|`/api/events`|SSE real-time stream|
|`GET`|`/health`|Server health check|

\---

## 🎯 Demo Script (For Hackathon)

**Step 1** — Open User Portal, type:

> \\\*"There is a huge fire near my house in Hitech City, smoke visible everywhere"\\\*

→ Watch AI classify as **Fire / HIGH** automatically

**Step 2** — Open Admin Panel, login as `admin / admin@123`
→ See complaint appear live in dashboard

**Step 3** — Click **▶ Start** on the complaint
→ Status changes to In Progress, citizen gets email

**Step 4** — Show **Analytics** tab
→ Charts with category distribution, trends

**Step 5** — Show **Disasters** tab
→ Sample Hyderabad flood + real USGS earthquake data

**Step 6** — Click **Send Emergency Alert**
→ Fill form, click send → WhatsApp + emails dispatched

**Step 7** — Show **Training Data** tab
→ 455 sample complaints used to train the AI

\---

## 👨‍💻 Built With

**Civix** — AI Civic Intelligence Platform
Hyderabad, Telangana | Hackathon Project 2026

\---

