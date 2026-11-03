const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// File Paths
const DATA_DIR = path.join(__dirname, 'data');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');
const STUDENTS_FILE = path.join(DATA_DIR, 'students.json');

// Ensure directory and files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SUBMISSIONS_FILE)) fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify([], null, 2));

// Permanent Default Student Roster
const DEFAULT_STUDENTS = [
  { studentId: "253001810157", name: "Shibaditya Acharya" },
  { studentId: "253001810159", name: "Arika Alam" },
  { studentId: "253001810156", name: "Ahona Das" },
  { studentId: "253001810151", name: "Tuhina Baidya" },
  { studentId: "253001810168", name: "Shubham Sarkar" },
  { studentId: "253001810145", name: "Tandrima Khutia" },
  { studentId: "253001810166", name: "Priyojit Mandal" },
  { studentId: "253001810148", name: "Rahul Biswas" },
  { studentId: "253001810164", name: "Pubali Banerjee" },
  { studentId: "253001810162", name: "Sayak Ghosal" },
  { studentId: "253001810161", name: "Twameka Chattopadhyaya" },
  { studentId: "253001810155", name: "Rajat shit" },
  { studentId: "253001810167", name: "Srishtatree karmakar" }
];

function ensureStudentRoster() {
  let existing = [];
  try {
    if (fs.existsSync(STUDENTS_FILE)) {
      existing = JSON.parse(fs.readFileSync(STUDENTS_FILE, 'utf8'));
    }
  } catch (e) {
    existing = [];
  }

  if (!Array.isArray(existing) || existing.length === 0) {
    const defaultRoster = DEFAULT_STUDENTS.map(s => ({
      studentId: s.studentId,
      name: s.name,
      password: s.studentId, // Password equals enrollment number
      status: "NOT_STARTED",
      lockReason: null,
      currentAnswers: {},
      currentIndex: 0,
      remainingSeconds: null,
      violations: [],
      score: null,
      totalQuestions: null,
      startedAt: null,
      submittedAt: null,
      timeSpentSeconds: null,
      verificationHash: null
    }));
    fs.writeFileSync(STUDENTS_FILE, JSON.stringify(defaultRoster, null, 2), 'utf8');
  }
}

ensureStudentRoster();

// Helper: Read JSON safely
function readJSON(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const content = fs.readFileSync(file, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Error reading ${file}:`, err);
    return fallback;
  }
}

// Helper: Write JSON safely
function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Error writing ${file}:`, err);
    return false;
  }
}

// Helper: Generate Secure System Password (e.g., QD-8391-X)
function generateSystemPassword(prefix = 'QD') {
  const digits = Math.floor(1000 + Math.random() * 9000);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const char = chars.charAt(Math.floor(Math.random() * chars.length));
  return `${prefix}-${digits}-${char}`;
}

// Fisher-Yates array shuffle
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// -----------------------------------------------------------------------------
// TEACHER BRUTE-FORCE PROTECTION & AUTHENTICATION
// -----------------------------------------------------------------------------
// IP/Username Failed Login Tracker
// key: ip -> { count: number, lockedUntil: number | null }
const loginFailures = new Map();
// Active authenticated teacher tokens (token -> expiry timestamp)
const teacherSessions = new Map();

function getClientIP(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
}

function checkTeacherAuth(req, res, next) {
  const token = req.headers['x-teacher-token'] || req.query.token;
  if (!token || !teacherSessions.has(token)) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Invalid or expired teacher session.' });
  }

  const expiry = teacherSessions.get(token);
  if (Date.now() > expiry) {
    teacherSessions.delete(token);
    return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
  }

  // Extend session by 2 hours
  teacherSessions.set(token, Date.now() + 2 * 60 * 60 * 1000);
  next();
}

// Teacher Login with Anti-Brute-Force Rate Limiting
app.post('/api/teacher/login', (req, res) => {
  const ip = getClientIP(req);
  const { username, passcode } = req.body;
  const now = Date.now();

  const config = readJSON(CONFIG_FILE, {});
  const maxAttempts = config.maxLoginAttempts || 5;
  const lockoutMs = (config.lockoutDurationMinutes || 15) * 60 * 1000;

  const failureRecord = loginFailures.get(ip) || { count: 0, lockedUntil: null };

  // Check if currently locked out
  if (failureRecord.lockedUntil && now < failureRecord.lockedUntil) {
    const remainingSeconds = Math.ceil((failureRecord.lockedUntil - now) / 1000);
    return res.status(429).json({
      success: false,
      message: `Security Lockout Active. Too many failed attempts. Try again in ${remainingSeconds} seconds.`,
      locked: true,
      remainingSeconds
    });
  }

  // Reset if lockout window has passed
  if (failureRecord.lockedUntil && now >= failureRecord.lockedUntil) {
    failureRecord.count = 0;
    failureRecord.lockedUntil = null;
  }

  const expectedUsername = process.env.TEACHER_USERNAME || config.teacherUsername || 'examiner';
  const expectedPasscode = process.env.TEACHER_PASSWORD || config.teacherPasscode || 'forensic@teacher2026';

  // Constant-time password check simulation
  const isUsernameMatch = (username || '').trim().toLowerCase() === expectedUsername.toLowerCase();
  const isPassMatch = passcode && crypto.timingSafeEqual(
    Buffer.from((passcode || '').padEnd(64, ' ')),
    Buffer.from(expectedPasscode.padEnd(64, ' '))
  );

  if (isUsernameMatch && isPassMatch) {
    // Reset failed count on successful authentication
    loginFailures.delete(ip);

    // Create session token (valid for 4 hours)
    const token = crypto.randomBytes(32).toString('hex');
    teacherSessions.set(token, now + 4 * 60 * 60 * 1000);

    return res.json({
      success: true,
      message: 'Teacher authenticated successfully.',
      token,
      username: expectedUsername
    });
  }

  // Handle Failed Attempt
  failureRecord.count += 1;
  const attemptsRemaining = Math.max(0, maxAttempts - failureRecord.count);

  if (failureRecord.count >= maxAttempts) {
    failureRecord.lockedUntil = now + lockoutMs;
    loginFailures.set(ip, failureRecord);
    return res.status(429).json({
      success: false,
      message: `Too many failed login attempts. Terminal locked for ${config.lockoutDurationMinutes || 15} minutes.`,
      locked: true,
      remainingSeconds: Math.ceil(lockoutMs / 1000)
    });
  }

  loginFailures.set(ip, failureRecord);
  return res.status(401).json({
    success: false,
    message: `Invalid credentials. Attempts remaining before security lockout: ${attemptsRemaining}`,
    attemptsRemaining
  });
});

// Teacher Logout
app.post('/api/teacher/logout', (req, res) => {
  const token = req.headers['x-teacher-token'];
  if (token) teacherSessions.delete(token);
  res.json({ success: true, message: 'Logged out.' });
});

// -----------------------------------------------------------------------------
// STUDENT AUTHENTICATION & SINGLE ATTEMPT / LOCK CONTROLS
// -----------------------------------------------------------------------------

// Active exam sessions mapping: studentId -> session metadata
const activeStudentSessions = new Map();

// Student Login
app.post('/api/student/login', (req, res) => {
  const { studentId, password } = req.body;

  if (!studentId || !password) {
    return res.status(400).json({ success: false, message: 'Student ID and Password are required.' });
  }

  const cleanId = studentId.trim();
  const cleanPass = password.trim();

  const students = readJSON(STUDENTS_FILE, []);
  const student = students.find(s => s.studentId.toLowerCase() === cleanId.toLowerCase());

  if (!student) {
    return res.status(404).json({ success: false, message: 'Student ID / Enrollment Number not found in exam roll.' });
  }

  // Password is same as enrollment / student ID
  const expectedPassword = student.password || student.studentId;
  const isPassMatch = cleanPass === expectedPassword || cleanPass.toLowerCase() === student.studentId.toLowerCase();

  if (!isPassMatch) {
    return res.status(401).json({ success: false, message: 'Incorrect password. Your password is your Enrollment Number.' });
  }

  // 1. Single Attempt Check: Cannot retake if already submitted
  if (student.status === 'SUBMITTED') {
    return res.status(403).json({
      success: false,
      status: 'SUBMITTED',
      message: 'Examination already completed and certified. Multiple attempts are strictly prohibited.'
    });
  }

  // 2. Lock Check: If page refreshed or disconnect occurred, teacher must unlock
  if (student.status === 'LOCKED') {
    return res.status(403).json({
      success: false,
      status: 'LOCKED',
      lockReason: student.lockReason || 'Page refreshed or session disconnected',
      message: `Your exam session is locked: "${student.lockReason || 'Page refreshed or exited'}". Please inform your teacher to unlock your session.`
    });
  }

  const config = readJSON(CONFIG_FILE, {});

  // 3. Teacher Master Control: Students cannot log in if teacher has not started the exam
  if (config.isExamLive === false) {
    return res.status(403).json({
      success: false,
      status: 'EXAM_NOT_STARTED',
      message: 'The examination has not been started by the instructor yet. Please wait until your teacher starts the exam.'
    });
  }

  const questions = readJSON(QUESTIONS_FILE, []);
  const durationMinutes = Number(config.durationMinutes) || 60;
  const totalSeconds = durationMinutes * 60;

  // Prepare questions: Randomize/Shuffle uniquely for each student
  let candidateQuestions = questions;
  if (!student.assignedQuestionIds || student.assignedQuestionIds.length === 0) {
    candidateQuestions = shuffleArray(questions);
    student.assignedQuestionIds = candidateQuestions.map(q => q.id);
  } else {
    // Rehydrate using student's persistent shuffled order
    const qMap = new Map(questions.map(q => [q.id, q]));
    candidateQuestions = student.assignedQuestionIds.map(id => qMap.get(id)).filter(Boolean);
    if (candidateQuestions.length === 0) {
      candidateQuestions = shuffleArray(questions);
      student.assignedQuestionIds = candidateQuestions.map(q => q.id);
    }
  }

  const sanitizedQuestions = candidateQuestions.map((q, idx) => {
    let options = q.options;
    if (config.randomizeOptions !== false) {
      options = shuffleArray(options);
    }
    return {
      index: idx + 1,
      id: q.id,
      category: q.category || 'General Forensics',
      question: q.question,
      options: options.map(opt => ({ id: opt.id, text: opt.text }))
    };
  });

  const now = Date.now();
  const sessionId = crypto.randomUUID();

  // If starting for the very first time
  if (student.status === 'NOT_STARTED') {
    student.status = 'IN_PROGRESS';
    student.startedAt = new Date(now).toISOString();
    student.remainingSeconds = totalSeconds;
    student.currentAnswers = {};
    student.currentIndex = 0;
    student.violations = [];
    writeJSON(STUDENTS_FILE, students);
  }

  // Active session tracking
  activeStudentSessions.set(student.studentId, {
    sessionId,
    studentId: student.studentId,
    ip: getClientIP(req),
    lastHeartbeat: now
  });

  res.json({
    success: true,
    sessionId,
    student: {
      studentId: student.studentId,
      name: student.name
    },
    examTitle: config.examTitle,
    examCode: config.examCode,
    durationMinutes,
    remainingSeconds: student.remainingSeconds || totalSeconds,
    currentAnswers: student.currentAnswers || {},
    currentIndex: student.currentIndex || 0,
    violationLimit: config.violationLimit || 3,
    questions: sanitizedQuestions
  });
});

// Periodic Progress Sync (Auto-saves answers & remaining time seamlessly)
app.post('/api/student/sync', (req, res) => {
  const { studentId, currentAnswers, currentIndex, remainingSeconds } = req.body;

  if (!studentId) return res.status(400).json({ success: false });

  const students = readJSON(STUDENTS_FILE, []);
  const student = students.find(s => s.studentId.toLowerCase() === studentId.trim().toLowerCase());

  if (student && student.status === 'IN_PROGRESS') {
    if (currentAnswers) student.currentAnswers = currentAnswers;
    if (currentIndex !== undefined) student.currentIndex = currentIndex;
    if (remainingSeconds !== undefined) student.remainingSeconds = remainingSeconds;
    student.lastActive = new Date().toISOString();
    writeJSON(STUDENTS_FILE, students);
  }

  res.json({ success: true });
});

// Lock Session Trigger (Fires when page refreshes, closes, or candidate exits)
app.post('/api/student/lock', (req, res) => {
  const { studentId, reason, currentAnswers, currentIndex, remainingSeconds } = req.body;

  if (!studentId) return res.status(400).json({ success: false });

  const students = readJSON(STUDENTS_FILE, []);
  const student = students.find(s => s.studentId.toLowerCase() === studentId.trim().toLowerCase());

  if (student && student.status === 'IN_PROGRESS') {
    student.status = 'LOCKED';
    student.lockReason = reason || 'Page refreshed or browser session disconnected';
    if (currentAnswers) student.currentAnswers = currentAnswers;
    if (currentIndex !== undefined) student.currentIndex = currentIndex;
    if (remainingSeconds !== undefined) student.remainingSeconds = remainingSeconds;
    student.lockedAt = new Date().toISOString();
    writeJSON(STUDENTS_FILE, students);
    console.log(`[EXAM LOCK] Student ${student.name} (${student.studentId}) locked: ${student.lockReason}`);
  }

  res.json({ success: true, locked: true });
});

// Security Violation Logged
app.post('/api/student/violation', (req, res) => {
  const { studentId, type, details } = req.body;

  if (!studentId) return res.status(400).json({ success: false });

  const students = readJSON(STUDENTS_FILE, []);
  const student = students.find(s => s.studentId.toLowerCase() === studentId.trim().toLowerCase());

  if (!student) return res.status(404).json({ success: false });

  const config = readJSON(CONFIG_FILE, {});
  const maxViolations = Number(config.violationLimit) || 3;

  if (!student.violations) student.violations = [];
  student.violations.push({
    type: type || 'BREACH',
    details: details || 'Proctoring alert',
    timestamp: new Date().toISOString()
  });

  const count = student.violations.length;
  let isLocked = false;

  if (count >= maxViolations) {
    student.status = 'LOCKED';
    const isTab = (type || '').includes('TAB') || (type || '').includes('BLUR');
    student.lockReason = isTab
      ? `Exceeded allowed security warnings (${count}/${maxViolations}): Tab switching detected`
      : `Exceeded allowed security warnings (${count}/${maxViolations}): Developer Tools / Tampering detected`;
    student.lockedAt = new Date().toISOString();
    isLocked = true;
  }

  writeJSON(STUDENTS_FILE, students);

  res.json({
    success: true,
    currentViolations: count,
    maxViolations,
    locked: isLocked,
    lockReason: student.lockReason
  });
});

// Student Final Submission
app.post('/api/student/submit', (req, res) => {
  const { studentId, answers } = req.body;

  if (!studentId) return res.status(400).json({ success: false, message: 'Student ID required.' });

  const students = readJSON(STUDENTS_FILE, []);
  const student = students.find(s => s.studentId.toLowerCase() === studentId.trim().toLowerCase());

  if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

  if (student.status === 'SUBMITTED') {
    return res.status(400).json({ success: false, message: 'Assessment already submitted.' });
  }

  const now = Date.now();
  const config = readJSON(CONFIG_FILE, {});
  const questions = readJSON(QUESTIONS_FILE, []);
  const studentAnswersMap = new Map();

  if (answers && typeof answers === 'object') {
    Object.keys(answers).forEach(qid => studentAnswersMap.set(qid, answers[qid]));
  }

  // Calculate score strictly on server
  let score = 0;
  const total = questions.length;
  const categoryStats = {};
  const questionResults = [];

  questions.forEach((q, idx) => {
    const studentChoice = studentAnswersMap.get(q.id) || null;
    const isCorrect = studentChoice === q.correctOption;
    if (isCorrect) score++;

    const cat = q.category || 'General Forensics';
    if (!categoryStats[cat]) categoryStats[cat] = { total: 0, correct: 0 };
    categoryStats[cat].total++;
    if (isCorrect) categoryStats[cat].correct++;

    questionResults.push({
      index: idx + 1,
      id: q.id,
      category: q.category,
      question: q.question,
      options: q.options,
      studentChoice,
      correctOption: q.correctOption,
      isCorrect,
      explanation: q.explanation || 'No explanation provided.'
    });
  });

  // Cryptographic Chain of Custody SHA-256 seal
  const hashPayload = `${student.studentId}:${student.name}:${score}:${total}:${student.startedAt}:${now}`;
  const verificationHash = crypto.createHash('sha256').update(hashPayload).digest('hex').toUpperCase();

  const startedTimeMs = student.startedAt ? new Date(student.startedAt).getTime() : now - 60000;
  const timeSpentSeconds = Math.max(1, Math.round((now - startedTimeMs) / 1000));

  // Update student record
  student.status = 'SUBMITTED';
  student.score = score;
  student.totalQuestions = total;
  student.isPassed = null;
  student.submittedAt = new Date(now).toISOString();
  student.timeSpentSeconds = timeSpentSeconds;
  student.verificationHash = verificationHash;
  student.currentAnswers = answers || {};
  writeJSON(STUDENTS_FILE, students);

  // Append to submissions.json
  const submissions = readJSON(SUBMISSIONS_FILE, []);
  const submissionRecord = {
    submissionId: 'SUB-' + crypto.randomUUID().substring(0, 8).toUpperCase(),
    candidate: { name: student.name, id: student.studentId },
    examTitle: config.examTitle,
    score,
    totalQuestions: total,
    violations: student.violations || [],
    violationCount: (student.violations || []).length,
    startedAt: student.startedAt,
    submittedAt: student.submittedAt,
    timeSpentSeconds,
    verificationHash
  };
  submissions.unshift(submissionRecord);
  writeJSON(SUBMISSIONS_FILE, submissions);

  // Return certified scorecard
  res.json({
    success: true,
    data: {
      submissionId: submissionRecord.submissionId,
      candidate: { name: student.name, id: student.studentId },
      examTitle: config.examTitle,
      score,
      totalQuestions: total,
      timeSpentSeconds,
      verificationHash,
      violations: student.violations || [],
      categoryStats,
      questionResults
    }
  });
});

// -----------------------------------------------------------------------------
// TEACHER DASHBOARD & PROGRESS MONITORING APIS
// -----------------------------------------------------------------------------

// Teacher: Get Real-Time Live Student Progress
app.get('/api/teacher/students', checkTeacherAuth, (req, res) => {
  const students = readJSON(STUDENTS_FILE, []);
  const questions = readJSON(QUESTIONS_FILE, []);
  const totalQuestions = questions.length;

  const progressList = students.map(s => {
    const answeredCount = s.currentAnswers ? Object.keys(s.currentAnswers).length : 0;
    return {
      studentId: s.studentId,
      name: s.name,
      password: s.password,
      status: s.status, // NOT_STARTED, IN_PROGRESS, LOCKED, SUBMITTED
      lockReason: s.lockReason || null,
      lockedAt: s.lockedAt || null,
      answeredCount,
      totalQuestions,
      currentIndex: (s.currentIndex || 0) + 1,
      remainingSeconds: s.remainingSeconds || null,
      violationCount: (s.violations || []).length,
      violations: s.violations || [],
      score: s.score,
      percentage: s.percentage,
      isPassed: s.isPassed,
      submittedAt: s.submittedAt,
      timeSpentSeconds: s.timeSpentSeconds,
      verificationHash: s.verificationHash
    };
  });

  const total = students.length;
  const inProgress = students.filter(s => s.status === 'IN_PROGRESS').length;
  const locked = students.filter(s => s.status === 'LOCKED').length;
  const submitted = students.filter(s => s.status === 'SUBMITTED').length;
  const notStarted = students.filter(s => s.status === 'NOT_STARTED').length;

  const config = readJSON(CONFIG_FILE, {});
  res.json({
    success: true,
    isExamLive: config.isExamLive === true,
    summary: { total, inProgress, locked, submitted, notStarted, totalQuestions },
    students: progressList
  });
});

// Teacher: Toggle Exam Live Master Switch
app.post('/api/teacher/exam/toggle', checkTeacherAuth, (req, res) => {
  const { isExamLive } = req.body;
  const config = readJSON(CONFIG_FILE, {});
  config.isExamLive = Boolean(isExamLive);
  writeJSON(CONFIG_FILE, config);

  console.log(`[MASTER SWITCH] Teacher set exam live status to: ${config.isExamLive ? 'LIVE' : 'CLOSED'}`);
  res.json({
    success: true,
    isExamLive: config.isExamLive,
    message: config.isExamLive
      ? 'Examination is now LIVE! Students can now log in.'
      : 'Examination is now CLOSED! Student logins are blocked.'
  });
});

// Teacher: Unlock a Locked Student
app.post('/api/teacher/students/unlock', checkTeacherAuth, (req, res) => {
  const { studentId } = req.body;

  if (!studentId) return res.status(400).json({ success: false, message: 'Student ID required.' });

  const students = readJSON(STUDENTS_FILE, []);
  const student = students.find(s => s.studentId.toLowerCase() === studentId.trim().toLowerCase());

  if (!student) {
    return res.status(404).json({ success: false, message: 'Student not found.' });
  }

  // Restore status to IN_PROGRESS so student can resume
  student.status = 'IN_PROGRESS';
  student.lockReason = null;
  student.lockedAt = null;
  student.violations = [];
  writeJSON(STUDENTS_FILE, students);

  console.log(`[EXAM UNLOCKED] Teacher unlocked student ${student.name} (${student.studentId})`);
  res.json({ success: true, message: `Account unlocked for ${student.name}. They may now continue their assessment.` });
});

// Teacher: Reset Password for a Student
app.post('/api/teacher/students/reset-password', checkTeacherAuth, (req, res) => {
  const { studentId } = req.body;
  if (!studentId) return res.status(400).json({ success: false, message: 'Student ID required.' });

  const students = readJSON(STUDENTS_FILE, []);
  const student = students.find(s => s.studentId.toLowerCase() === studentId.trim().toLowerCase());

  if (!student) {
    return res.status(404).json({ success: false, message: 'Student not found.' });
  }

  student.password = student.studentId;
  writeJSON(STUDENTS_FILE, students);

  console.log(`[PASSWORD RESET] Teacher reset password for ${student.name} (${student.studentId}) -> ${student.password}`);
  res.json({
    success: true,
    newPassword: student.password,
    message: `Password for ${student.name} (${student.studentId}) is set to their Enrollment Number: ${student.password}`
  });
});

// Teacher: Reset Exam for a Student (Fresh Retake)
app.post('/api/teacher/students/reset-exam', checkTeacherAuth, (req, res) => {
  const { studentId } = req.body;
  if (!studentId) return res.status(400).json({ success: false, message: 'Student ID required.' });

  const students = readJSON(STUDENTS_FILE, []);
  const student = students.find(s => s.studentId.toLowerCase() === studentId.trim().toLowerCase());

  if (!student) {
    return res.status(404).json({ success: false, message: 'Student not found.' });
  }

  // Completely reset exam state
  student.status = 'NOT_STARTED';
  student.lockReason = null;
  student.lockedAt = null;
  student.currentAnswers = {};
  student.currentIndex = 0;
  student.remainingSeconds = null;
  student.violations = [];
  student.score = null;
  student.totalQuestions = null;
  student.percentage = null;
  student.isPassed = null;
  student.startedAt = null;
  student.submittedAt = null;
  student.timeSpentSeconds = null;
  student.verificationHash = null;
  delete student.assignedQuestionIds;
  writeJSON(STUDENTS_FILE, students);

  // Remove previous submission record if any
  const submissions = readJSON(SUBMISSIONS_FILE, []);
  const filteredSubmissions = submissions.filter(s => s.candidate?.id?.toLowerCase() !== student.studentId.toLowerCase());
  writeJSON(SUBMISSIONS_FILE, filteredSubmissions);

  console.log(`[EXAM RESET] Teacher reset exam for ${student.name} (${student.studentId})`);
  res.json({
    success: true,
    message: `Exam for ${student.name} (${student.studentId}) has been completely reset. They can now start fresh.`
  });
});

// Teacher: Remove a Student from Roster
app.post('/api/teacher/students/delete', checkTeacherAuth, (req, res) => {
  const { studentId } = req.body;
  if (!studentId) return res.status(400).json({ success: false, message: 'Student ID required.' });

  const students = readJSON(STUDENTS_FILE, []);
  const studentIndex = students.findIndex(s => s.studentId.toLowerCase() === studentId.trim().toLowerCase());

  if (studentIndex === -1) {
    return res.status(404).json({ success: false, message: 'Student not found.' });
  }

  const removedStudent = students.splice(studentIndex, 1)[0];
  writeJSON(STUDENTS_FILE, students);

  // Clear from active sessions
  activeStudentSessions.delete(removedStudent.studentId);

  // Remove previous submission record if any
  const submissions = readJSON(SUBMISSIONS_FILE, []);
  const filteredSubmissions = submissions.filter(s => s.candidate?.id?.toLowerCase() !== removedStudent.studentId.toLowerCase());
  writeJSON(SUBMISSIONS_FILE, filteredSubmissions);

  console.log(`[STUDENT REMOVED] Teacher removed student ${removedStudent.name} (${removedStudent.studentId})`);
  res.json({
    success: true,
    message: `Student ${removedStudent.name} (${removedStudent.studentId}) has been removed from the roster.`
  });
});

// Teacher: Import Students from CSV / Text with Auto System Password Generation
app.post('/api/teacher/students/import-csv', checkTeacherAuth, (req, res) => {
  const { csvText, mode } = req.body; // mode: 'replace' | 'append'

  if (!csvText || typeof csvText !== 'string') {
    return res.status(400).json({ success: false, message: 'CSV text data required.' });
  }

  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) {
    return res.status(400).json({ success: false, message: 'CSV contains no rows.' });
  }

  const newStudents = [];
  const existingStudents = readJSON(STUDENTS_FILE, []);
  const existingIds = new Set(existingStudents.map(s => s.studentId.toLowerCase()));

  // Process rows (Supports header detection: Name, StudentID or Roll, Name)
  let startIndex = 0;
  const firstLine = lines[0].toLowerCase();
  if (firstLine.includes('name') || firstLine.includes('roll') || firstLine.includes('id')) {
    startIndex = 1;
  }

  for (let i = startIndex; i < lines.length; i++) {
    const parts = lines[i].split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
    if (parts.length < 2) continue;

    // Detect which column is ID vs Name
    let studentId = '';
    let name = '';

    if (/\d/.test(parts[0]) && !/\d/.test(parts[1])) {
      studentId = parts[0];
      name = parts[1];
    } else if (!/\d/.test(parts[0]) && /\d/.test(parts[1])) {
      name = parts[0];
      studentId = parts[1];
    } else {
      studentId = parts[0];
      name = parts[1];
    }

    if (!studentId || !name) continue;

    const password = studentId; // Password is identical to Enrollment / Student ID

    newStudents.push({
      studentId,
      name,
      password,
      status: 'NOT_STARTED',
      lockReason: null,
      currentAnswers: {},
      currentIndex: 0,
      remainingSeconds: null,
      violations: [],
      score: null,
      totalQuestions: null,
      percentage: null,
      isPassed: null,
      startedAt: null,
      submittedAt: null,
      timeSpentSeconds: null,
      verificationHash: null
    });
  }

  if (newStudents.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Could not extract valid student rows. Ensure format is: StudentID, Student Name'
    });
  }

  let finalStudents = [];
  if (mode === 'append') {
    finalStudents = [...existingStudents, ...newStudents];
  } else {
    finalStudents = newStudents;
  }

  writeJSON(STUDENTS_FILE, finalStudents);
  res.json({
    success: true,
    message: `Successfully generated credentials for ${newStudents.length} students.`,
    count: finalStudents.length
  });
});

// Teacher: Download Credentials Sheet (CSV) with System-Generated Passwords
app.get('/api/teacher/students/export-credentials', checkTeacherAuth, (req, res) => {
  const students = readJSON(STUDENTS_FILE, []);
  const headers = ['Student ID', 'Student Name', 'System Password', 'Status'];
  const rows = students.map(s => [
    `"${s.studentId}"`,
    `"${(s.name || '').replace(/"/g, '""')}"`,
    `"${s.password}"`,
    `"${s.status}"`
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="student_credentials_passwords.csv"');
  res.send(csv);
});

// Teacher: Download Full Progress & Results Sheet (CSV)
app.get('/api/teacher/export-progress', checkTeacherAuth, (req, res) => {
  const students = readJSON(STUDENTS_FILE, []);
  const headers = [
    'Enrollment / Student ID',
    'Student Name',
    'Password',
    'Status',
    'Lock Reason',
    'Score',
    'Total Questions',
    'Violations Count',
    'Time Spent (s)',
    'Started At',
    'Submitted At',
    'Chain SHA-256 Hash'
  ];

  const rows = students.map(s => [
    `"${s.studentId}"`,
    `"${(s.name || '').replace(/"/g, '""')}"`,
    `"${s.password || s.studentId}"`,
    `"${s.status}"`,
    `"${(s.lockReason || '').replace(/"/g, '""')}"`,
    s.score !== null ? s.score : '',
    s.totalQuestions !== null ? s.totalQuestions : '',
    (s.violations || []).length,
    s.timeSpentSeconds !== null ? s.timeSpentSeconds : '',
    `"${s.startedAt || ''}"`,
    `"${s.submittedAt || ''}"`,
    `"${s.verificationHash || ''}"`
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="forensic_students_progress_sheet.csv"');
  res.send(csv);
});

// Teacher: Question Bank Management
app.get('/api/teacher/questions', checkTeacherAuth, (req, res) => {
  const questions = readJSON(QUESTIONS_FILE, []);
  res.json({ success: true, count: questions.length, questions });
});

app.post('/api/teacher/questions', checkTeacherAuth, (req, res) => {
  const { questions, mode } = req.body;

  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ success: false, message: 'Invalid question list.' });
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.question || !Array.isArray(q.options) || q.options.length < 2 || !q.correctOption) {
      return res.status(400).json({
        success: false,
        message: `Question #${i + 1} is invalid. Needs question, options, and correctOption.`
      });
    }
  }

  let finalQuestions = [];
  if (mode === 'append') {
    const existing = readJSON(QUESTIONS_FILE, []);
    finalQuestions = [...existing, ...questions];
  } else {
    finalQuestions = questions;
  }

  writeJSON(QUESTIONS_FILE, finalQuestions);
  res.json({ success: true, message: `Question bank updated (${finalQuestions.length} questions).`, count: finalQuestions.length });
});

// Teacher: Update Config
app.post('/api/teacher/config', checkTeacherAuth, (req, res) => {
  const current = readJSON(CONFIG_FILE, {});
  const updated = { ...current, ...req.body };
  writeJSON(CONFIG_FILE, updated);
  res.json({ success: true, message: 'Settings saved.', config: updated });
});

// Public Exam Info
app.get('/api/quiz/info', (req, res) => {
  const config = readJSON(CONFIG_FILE, {});
  const questions = readJSON(QUESTIONS_FILE, []);
  res.json({
    success: true,
    isExamLive: config.isExamLive === true,
    examTitle: config.examTitle || 'Questioned Document Examination',
    examCode: config.examCode || '',
    organization: config.organization || 'Department of Forensic Science',
    durationMinutes: config.durationMinutes || 60,
    violationLimit: config.violationLimit || 3,
    passingScorePercent: config.passingScorePercent || 70,
    totalQuestions: questions.length
  });
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'HEALTHY', timestamp: new Date().toISOString() });
});

// Intelligent Port Binding with Fallback
let DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`\n======================================================`);
    console.log(`[FORENSIC QUIZ CORE] Student Portal: http://localhost:${port}`);
    console.log(`[TEACHER PORTAL]     Command Desk:   http://localhost:${port}/teacher.html`);
    console.log(`[ZERO-KNOWLEDGE]     Answer key secured in server memory.`);
    console.log(`[THEME & AUDIO]      Clean White Lab Theme | Audio Muted`);
    console.log(`======================================================\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[PORT NOTICE] Port ${port} is occupied. Attempting fallback...`);
      const nextPort = port === 3000 ? 3030 : port + 1;
      startServer(nextPort);
    } else {
      console.error('[SERVER ERROR]', err);
    }
  });
}

startServer(DEFAULT_PORT);
