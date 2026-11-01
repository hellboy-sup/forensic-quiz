# 🛡️ Digital Forensic Proctored Assessment Terminal

An advanced, cybernetic-themed **Forensic Quiz Application** built on Node.js and Express, purpose-engineered for cybersecurity and digital forensics examinations.

It implements **modern online proctoring anti-cheat architecture** designed to resist client-side tampering, inspect element, and DevTools exploitation.

---

## 🔒 Modern Anti-Cheat & Anti-Tamper Security Architecture

### 1. Zero-Knowledge Client Architecture (Complete DevTools Defense)
* **The Problem:** In simple quiz apps, answers or hints reside in JavaScript variables, JSON arrays, hidden HTML attributes, or network responses. Students opening DevTools (`F12`) easily inspect variables or responses to extract the answers.
* **The Forensic Engine Solution:** 
  - The frontend **never receives the answer key**.
  - When questions are dispatched from `/api/quiz/start`, the server strips `correctOption`, `explanation`, and all answer metadata.
  - The answer key exists **solely in server memory**.
  - Even if students decompile scripts, inspect the DOM, view network request payloads, or freeze breakpoints, **there is literally zero answer data in the client's browser**.
  - Scoring is performed server-side upon POST submission to `/api/quiz/submit`.

### 2. DevTools Traps & Heuristics
* Intercepts `F12`, `Ctrl+Shift+I`, `Ctrl+Shift+J`, `Ctrl+Shift+C`, `Ctrl+U` (view source), `Ctrl+S`, `Ctrl+P`, `Ctrl+C`, `Ctrl+V`.
* Context menu (Right-click) is completely locked.
* Continuous console flushing and **getter evaluation traps** that detect when developer console inspection is active.
* Viewport dimension disparity monitoring to detect docked DevTools panes.

### 3. Lockdown & Chain of Custody Telemetry
* **Mandatory Fullscreen**: Exiting fullscreen triggers a high-priority red alert overlay with a 10-second grace countdown and siren sound.
* **Tab & Focus Loss Detection**: Switching tabs, minimizing windows, or moving focus to an external monitor immediately logs a security violation to the server.
* **Auto-Termination**: If a student accumulates more than the permitted violation threshold (default: 3), the test auto-terminates and flags the attempt as compromised.
* **Cryptographic Hash (SHA-256)**: Generates a tamper-evident chain-of-custody verification hash over the student's ID, score, timestamp, and incident log.

---

## 🎨 Forensic Look & Feel
* **Aesthetic**: Deep cyber-dark slate palette with glowing cyan and emerald accents, scanlines, and tactical HUD brackets.
* **Audio Telemetry**: Native Web Audio API sound synthesizer (no external audio files required) providing tactical clicks, navigation cues, warning sirens, and completion fanfare. Includes audio mute toggle.
* **Interactive HUD**: Live countdown chronometer, question matrix palette (answered, flagged, unanswered), artifact metadata tags, and live chain-of-custody telemetry stream.

---

## 🚀 Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
# or development mode:
npm run dev
```

Visit in your browser:
* Candidate Portal: `http://localhost:3030`
* Examiner Admin Console: `http://localhost:3030/admin.html` (Passcode: `forensic@admin2026`)

---

## ☁️ Deploying to Render (onrender.com)

This repository is ready for 1-click deployment on [Render](https://render.com):

1. **Push your code to GitHub / GitLab**.
2. Log in to [Render Dashboard](https://dashboard.render.com).
3. Click **New +** > **Web Service**.
4. Connect your Git repository.
5. Configure the service settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: `Free`
6. Click **Deploy Web Service**.
7. Render will provide a live URL like `https://forensic-quiz-terminal.onrender.com`.

---

## 📝 Uploading Your Own Questions & Answers

You can upload questions at any time without restarting the server:

### Option A: Via Examiner Admin Console (Recommended)
1. Navigate to `/admin.html` and enter the passcode `forensic@admin2026`.
2. Click the **Question Bank & Upload** tab.
3. Either:
   - Drag and drop your `.json` question file into the upload zone.
   - Paste and edit the JSON directly in the interactive editor and click **Save Question Bank**.
4. Choose whether to **Replace** or **Append** to existing questions.

### Option B: Directly in the codebase
Edit the file at [`data/questions.json`](data/questions.json) using this standard format:

```json
[
  {
    "id": "DF-101",
    "category": "Disk Forensics",
    "question": "What is the primary purpose of a write blocker in digital forensics?",
    "options": [
      { "id": "A", "text": "To prevent accidental or intentional alteration of evidence during acquisition." },
      { "id": "B", "text": "To accelerate data transfer speed across SATA and NVMe buses." },
      { "id": "C", "text": "To bypass BitLocker hardware-level AES-256 encryption." },
      { "id": "D", "text": "To decrypt deleted Volume Shadow Copies on NTFS partitions." }
    ],
    "correctOption": "A",
    "explanation": "Hardware or software write blockers intercept write commands, guaranteeing the source disk remains bit-for-bit pristine during forensic imaging."
  }
]
```

---

## ⚙️ Administration & Instructor Features
* **Live KPI Dashboard**: Total candidates, pass rate, average percentage, security violations.
* **Audit Table**: Full candidate dossier, question-by-question breakdown, and tamper logs.
* **One-Click CSV Export**: Download complete grades and verification hashes into Excel/CSV.
* **Configurable Exam Settings**: Duration, passing score, violation threshold, randomization options, and admin passcode.

