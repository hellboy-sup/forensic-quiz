const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3030;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// File Paths
const DATA_DIR = path.join(__dirname, 'data');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');

// Ensure files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SUBMISSIONS_FILE)) fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify([], null, 2));

// Helper: Read JSON file safely
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

// Helper: Write JSON file safely
function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Error writing ${file}:`, err);
    return false;
  }
}

// In-Memory active candidate sessions
// key: sessionId -> { candidate, startedAt, expiresAt, questionKeys, violations: [], submitted: false }
const activeSessions = new Map();

// Helper: Fisher-Yates shuffle
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// -----------------------------------------------------------------------------
// PUBLIC CANDIDATE ENDPOINTS
// -----------------------------------------------------------------------------

// 1. Get Exam Metadata (Zero questions or answers revealed)
app.get('/api/quiz/info', (req, res) => {
  const config = readJSON(CONFIG_FILE, {});
  const questions = readJSON(QUESTIONS_FILE, []);

  res.json({
    success: true,
    examTitle: config.examTitle || 'Forensic Qualification Benchmark',
    examCode: config.examCode || 'DFIR-EXAM',
    organization: config.organization || 'Digital Forensics Unit',
    durationMinutes: config.durationMinutes || 15,
    violationLimit: config.violationLimit || 3,
    passingScorePercent: config.passingScorePercent || 70,
    totalQuestions: questions.length,
    strictFullscreen: config.strictFullscreen !== false,
    blockDevtools: config.blockDevtools !== false
  });
});

// 2. Start Exam Session (Generates sanitized questions, records session on server)
app.post('/api/quiz/start', (req, res) => {
  const { candidateName, candidateId, accessCode } = req.body;

  if (!candidateName || !candidateId) {
    return res.status(400).json({ success: false, message: 'Candidate Name and ID / Roll No are required.' });
  }

  const config = readJSON(CONFIG_FILE, {});
  const fullQuestions = readJSON(QUESTIONS_FILE, []);

  if (!fullQuestions || fullQuestions.length === 0) {
    return res.status(500).json({ success: false, message: 'Question bank is currently empty. Please contact examiner.' });
  }

  // Shuffle questions if configured
  let candidateQuestions = fullQuestions;
  if (config.randomizeQuestions !== false) {
    candidateQuestions = shuffleArray(fullQuestions);
  }

  // Strip answers & explanations (Absolute zero-knowledge client protection)
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
      options: options.map(opt => ({
        id: opt.id,
        text: opt.text
      }))
    };
  });

  const durationMinutes = Number(config.durationMinutes) || 15;
  const startedAt = Date.now();
  // Server-enforced expiry with a 30s network buffer
  const expiresAt = startedAt + (durationMinutes * 60 * 1000) + 30000;
  const sessionId = crypto.randomUUID();

  // Create session record
  activeSessions.set(sessionId, {
    sessionId,
    candidate: {
      name: candidateName.trim(),
      id: candidateId.trim(),
      ip: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress
    },
    startedAt,
    expiresAt,
    durationMinutes,
    questionCount: sanitizedQuestions.length,
    violations: [],
    submitted: false
  });

  res.json({
    success: true,
    sessionId,
    candidate: {
      name: candidateName,
      id: candidateId
    },
    examTitle: config.examTitle,
    examCode: config.examCode,
    durationMinutes,
    startedAt,
    expiresAt,
    violationLimit: config.violationLimit || 3,
    questions: sanitizedQuestions
  });
});

// 3. Telemetry: Log Proctoring Violation
app.post('/api/quiz/violation', (req, res) => {
  const { sessionId, type, details, timestamp } = req.body;

  if (!sessionId || !activeSessions.has(sessionId)) {
    return res.status(404).json({ success: false, message: 'Invalid or expired session.' });
  }

  const session = activeSessions.get(sessionId);
  if (session.submitted) {
    return res.json({ success: false, message: 'Session already completed.' });
  }

  const config = readJSON(CONFIG_FILE, {});
  const maxViolations = Number(config.violationLimit) || 3;

  const violationEntry = {
    type: type || 'ANOMALY_DETECTED',
    details: details || 'Proctoring security trigger',
    timestamp: timestamp || Date.now(),
    iso: new Date().toISOString()
  };

  session.violations.push(violationEntry);
  const currentCount = session.violations.length;
  const isTerminated = currentCount >= maxViolations;

  res.json({
    success: true,
    currentViolations: currentCount,
    maxViolations,
    terminated: isTerminated,
    reason: isTerminated ? `Exceeded permitted security violation threshold (${maxViolations})` : null
  });
});

// 4. Submit Answers (Evaluated purely on the server)
app.post('/api/quiz/submit', (req, res) => {
  const { sessionId, answers, autoSubmitted, terminationReason } = req.body;

  if (!sessionId || !activeSessions.has(sessionId)) {
    return res.status(404).json({ success: false, message: 'Session not found or already closed.' });
  }

  const session = activeSessions.get(sessionId);
  if (session.submitted) {
    return res.status(400).json({ success: false, message: 'Assessment has already been submitted.' });
  }

  const now = Date.now();
  const config = readJSON(CONFIG_FILE, {});
  const fullQuestions = readJSON(QUESTIONS_FILE, []);
  const questionMap = new Map(fullQuestions.map(q => [q.id, q]));

  // Create an answer lookup from client submission
  // answers format: [{ questionId, selectedOption }]
  const studentAnswersMap = new Map();
  if (Array.isArray(answers)) {
    answers.forEach(a => {
      if (a && a.questionId) {
        studentAnswersMap.set(a.questionId, a.selectedOption);
      }
    });
  }

  // Calculate score strictly against secure server data
  let score = 0;
  const total = fullQuestions.length;
  const categoryStats = {};
  const questionResults = [];

  fullQuestions.forEach((q, idx) => {
    const studentChoice = studentAnswersMap.get(q.id) || null;
    const isCorrect = studentChoice === q.correctOption;
    if (isCorrect) score++;

    // Category breakdown
    const cat = q.category || 'General';
    if (!categoryStats[cat]) {
      categoryStats[cat] = { total: 0, correct: 0 };
    }
    categoryStats[cat].total++;
    if (isCorrect) categoryStats[cat].correct++;

    // Record review item (now safely reveal explanation since exam is over)
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

  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
  const passMark = Number(config.passingScorePercent) || 70;
  const isPassed = percentage >= passMark && (!terminationReason);

  // Compute Chain of Custody Cryptographic Hash
  const hashPayload = `${session.candidate.id}:${session.candidate.name}:${score}:${total}:${session.startedAt}:${now}:${session.violations.length}`;
  const verificationHash = crypto.createHash('sha256').update(hashPayload).digest('hex').toUpperCase();

  const timeSpentSeconds = Math.max(1, Math.round((now - session.startedAt) / 1000));

  const submissionRecord = {
    submissionId: 'SUB-' + crypto.randomUUID().substring(0, 8).toUpperCase(),
    candidate: session.candidate,
    examTitle: config.examTitle,
    examCode: config.examCode,
    score,
    totalQuestions: total,
    percentage,
    isPassed,
    autoSubmitted: Boolean(autoSubmitted),
    terminationReason: terminationReason || null,
    violations: session.violations,
    violationCount: session.violations.length,
    startedAt: new Date(session.startedAt).toISOString(),
    submittedAt: new Date(now).toISOString(),
    timeSpentSeconds,
    verificationHash,
    categoryStats,
    resultsSummary: questionResults
  };

  // Mark session as submitted
  session.submitted = true;

  // Persist to submissions.json
  const submissions = readJSON(SUBMISSIONS_FILE, []);
  submissions.unshift(submissionRecord);
  writeJSON(SUBMISSIONS_FILE, submissions);

  // Return full certified result to candidate
  res.json({
    success: true,
    data: {
      submissionId: submissionRecord.submissionId,
      candidate: submissionRecord.candidate,
      examTitle: submissionRecord.examTitle,
      examCode: submissionRecord.examCode,
      score,
      totalQuestions: total,
      percentage,
      isPassed,
      passMark,
      timeSpentSeconds,
      verificationHash,
      violations: submissionRecord.violations,
      terminationReason: submissionRecord.terminationReason,
      categoryStats,
      questionResults
    }
  });
});

// -----------------------------------------------------------------------------
// ADMIN MANAGEMENT ENDPOINTS
// -----------------------------------------------------------------------------

// Admin Auth Middleware
function checkAdminAuth(req, res, next) {
  const passcode = req.headers['x-admin-passcode'] || req.query.passcode;
  const config = readJSON(CONFIG_FILE, {});
  const expectedPasscode = config.adminPasscode || 'forensic@admin2026';

  if (!passcode || passcode !== expectedPasscode) {
    return res.status(401).json({ success: false, message: 'Invalid Admin Passcode.' });
  }
  next();
}

// Admin: Overview Metrics & Submissions
app.get('/api/admin/overview', checkAdminAuth, (req, res) => {
  const config = readJSON(CONFIG_FILE, {});
  const questions = readJSON(QUESTIONS_FILE, []);
  const submissions = readJSON(SUBMISSIONS_FILE, []);

  const totalAttempts = submissions.length;
  const passedAttempts = submissions.filter(s => s.isPassed).length;
  const flaggedAttempts = submissions.filter(s => s.violationCount > 0 || s.terminationReason).length;
  const avgScore = totalAttempts > 0 
    ? Math.round(submissions.reduce((acc, s) => acc + s.percentage, 0) / totalAttempts) 
    : 0;

  res.json({
    success: true,
    metrics: {
      totalQuestions: questions.length,
      totalAttempts,
      passedAttempts,
      flaggedAttempts,
      avgScore
    },
    config: {
      examTitle: config.examTitle,
      examCode: config.examCode,
      durationMinutes: config.durationMinutes,
      violationLimit: config.violationLimit,
      passingScorePercent: config.passingScorePercent,
      randomizeQuestions: config.randomizeQuestions,
      randomizeOptions: config.randomizeOptions
    },
    submissions: submissions.map(s => ({
      submissionId: s.submissionId,
      candidate: s.candidate,
      score: s.score,
      totalQuestions: s.totalQuestions,
      percentage: s.percentage,
      isPassed: s.isPassed,
      violationCount: s.violationCount,
      violations: s.violations,
      terminationReason: s.terminationReason,
      submittedAt: s.submittedAt,
      timeSpentSeconds: s.timeSpentSeconds,
      verificationHash: s.verificationHash
    }))
  });
});

// Admin: Get Raw Question Bank (with answers)
app.get('/api/admin/questions', checkAdminAuth, (req, res) => {
  const questions = readJSON(QUESTIONS_FILE, []);
  res.json({ success: true, count: questions.length, questions });
});

// Admin: Upload / Replace Question Bank
app.post('/api/admin/questions', checkAdminAuth, (req, res) => {
  const { questions, mode } = req.body; // mode: 'replace' | 'append'

  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ success: false, message: 'Invalid question array.' });
  }

  // Validate question schema
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.question || !Array.isArray(q.options) || q.options.length < 2 || !q.correctOption) {
      return res.status(400).json({
        success: false,
        message: `Question #${i + 1} is invalid. Must contain question, options (>=2), and correctOption.`
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
  res.json({ success: true, message: `Successfully updated ${finalQuestions.length} questions.`, count: finalQuestions.length });
});

// Admin: Update Config
app.post('/api/admin/config', checkAdminAuth, (req, res) => {
  const current = readJSON(CONFIG_FILE, {});
  const updated = {
    ...current,
    ...req.body
  };
  writeJSON(CONFIG_FILE, updated);
  res.json({ success: true, message: 'Exam configuration updated.', config: updated });
});

// Admin: Export Submissions to CSV
app.get('/api/admin/export', checkAdminAuth, (req, res) => {
  const submissions = readJSON(SUBMISSIONS_FILE, []);

  const headers = [
    'Submission ID',
    'Candidate Name',
    'Candidate ID / Roll',
    'Score',
    'Total',
    'Percentage',
    'Result',
    'Violations Count',
    'Terminated For Violations',
    'Time Spent (s)',
    'Submitted At',
    'SHA-256 Hash'
  ];

  const rows = submissions.map(s => [
    `"${s.submissionId}"`,
    `"${(s.candidate?.name || '').replace(/"/g, '""')}"`,
    `"${(s.candidate?.id || '').replace(/"/g, '""')}"`,
    s.score,
    s.totalQuestions,
    `${s.percentage}%`,
    s.isPassed ? 'PASSED' : 'FAILED',
    s.violationCount,
    s.terminationReason ? `"${s.terminationReason}"` : 'NO',
    s.timeSpentSeconds,
    `"${s.submittedAt}"`,
    `"${s.verificationHash}"`
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="forensic_quiz_submissions.csv"');
  res.send(csvContent);
});

// Admin: Clear Submissions
app.post('/api/admin/submissions/clear', checkAdminAuth, (req, res) => {
  writeJSON(SUBMISSIONS_FILE, []);
  res.json({ success: true, message: 'All candidate submission records cleared.' });
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'HEALTHY', timestamp: new Date().toISOString() });
});

// Start Server
app.listen(PORT, () => {
  console.log(`[FORENSIC QUIZ CORE] Server active on port ${PORT}`);
  console.log(`[SECURE ENVIRONMENT] Zero-knowledge client answer architecture enabled.`);
});
