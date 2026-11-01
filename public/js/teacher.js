/**
 * TEACHER COMMAND DESK CONTROLLER
 * Real-time student progress monitor, account unlocking, and CSV credential management.
 */

document.addEventListener('DOMContentLoaded', () => {
  let teacherToken = sessionStorage.getItem('forensic_teacher_token') || '';
  let pollInterval = null;

  // DOM Elements
  const authGate = document.getElementById('authGate');
  const teacherUserInput = document.getElementById('teacherUser');
  const teacherPassInput = document.getElementById('teacherPass');
  const loginBtn = document.getElementById('loginBtn');
  const loginAlert = document.getElementById('loginAlert');
  const logoutBtn = document.getElementById('logoutBtn');

  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  // KPIs
  const kpiTotalStudents = document.getElementById('kpiTotalStudents');
  const kpiInProgress = document.getElementById('kpiInProgress');
  const kpiLocked = document.getElementById('kpiLocked');
  const kpiSubmitted = document.getElementById('kpiSubmitted');

  // Progress Table
  const tableBody = document.getElementById('studentProgressTableBody');
  const downloadProgressSheetBtn = document.getElementById('downloadProgressSheetBtn');
  const downloadCredsBtnTop = document.getElementById('downloadCredsBtnTop');

  // CSV Roster
  const studentDropzone = document.getElementById('studentDropzone');
  const studentFileInput = document.getElementById('studentFileInput');
  const studentCsvTextarea = document.getElementById('studentCsvTextarea');
  const importCsvBtn = document.getElementById('importCsvBtn');

  // Question Bank
  const qCountBadge = document.getElementById('qCountBadge');
  const rawQuestionEditor = document.getElementById('rawQuestionEditor');
  const saveQuestionsBtn = document.getElementById('saveQuestionsBtn');

  // Settings
  const cfgTitle = document.getElementById('cfgTitle');
  const cfgDuration = document.getElementById('cfgDuration');
  const cfgViolations = document.getElementById('cfgViolations');
  const cfgPassMark = document.getElementById('cfgPassMark');
  const cfgPasscode = document.getElementById('cfgPasscode');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');

  // Master Exam Switch Elements
  const masterStatusBadge = document.getElementById('masterStatusBadge');
  const masterStatusDesc = document.getElementById('masterStatusDesc');
  const toggleExamLiveBtn = document.getElementById('toggleExamLiveBtn');
  let isCurrentExamLive = false;

  if (toggleExamLiveBtn) {
    toggleExamLiveBtn.addEventListener('click', async () => {
      const targetState = !isCurrentExamLive;
      const confirmMsg = targetState
        ? 'Are you sure you want to START the examination? Students will now be allowed to log in and take their test.'
        : 'Are you sure you want to CLOSE the examination? Student logins will be blocked.';
      if (!confirm(confirmMsg)) return;

      try {
        const res = await fetch('/api/teacher/exam/toggle', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-teacher-token': teacherToken
          },
          body: JSON.stringify({ isExamLive: targetState })
        });
        const data = await res.json();
        if (data.success) {
          alert(data.message);
          fetchLiveProgress();
        } else {
          alert(`Error: ${data.message}`);
        }
      } catch (err) {
        alert('Failed to toggle examination status.');
      }
    });
  }

  // Check saved session
  if (teacherToken) {
    verifySession();
  }

  // Teacher Login with Anti-Brute-Force Feedback
  async function handleLogin() {
    const username = teacherUserInput.value.trim();
    const passcode = teacherPassInput.value.trim();

    if (!username || !passcode) {
      showLoginAlert('Username and passcode are required.');
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = 'AUTHENTICATING...';
    loginAlert.style.display = 'none';

    try {
      const res = await fetch('/api/teacher/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, passcode })
      });

      const data = await res.json();

      if (data.success) {
        teacherToken = data.token;
        sessionStorage.setItem('forensic_teacher_token', teacherToken);
        authGate.style.display = 'none';
        startDashboard();
      } else {
        loginBtn.disabled = false;
        loginBtn.textContent = 'AUTHORIZE & ENTER ➔';
        showLoginAlert(data.message);
      }
    } catch (err) {
      loginBtn.disabled = false;
      loginBtn.textContent = 'AUTHORIZE & ENTER ➔';
      showLoginAlert('Network communication error with server.');
    }
  }

  loginBtn.addEventListener('click', handleLogin);
  teacherPassInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLogin();
  });

  logoutBtn.addEventListener('click', async () => {
    clearInterval(pollInterval);
    await fetch('/api/teacher/logout', {
      method: 'POST',
      headers: { 'x-teacher-token': teacherToken }
    });
    sessionStorage.removeItem('forensic_teacher_token');
    teacherToken = '';
    authGate.style.display = 'flex';
  });

  function showLoginAlert(msg) {
    loginAlert.textContent = msg;
    loginAlert.style.cssText = 'display:block; background:#fef2f2; border:1px solid #fecaca; color:#b91c1c;';
  }

  async function verifySession() {
    try {
      const res = await fetch('/api/teacher/students', {
        headers: { 'x-teacher-token': teacherToken }
      });
      const data = await res.json();
      if (data.success) {
        authGate.style.display = 'none';
        startDashboard();
      } else {
        sessionStorage.removeItem('forensic_teacher_token');
        authGate.style.display = 'flex';
      }
    } catch (err) {
      authGate.style.display = 'flex';
    }
  }

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(btn.dataset.tab);
      if (target) target.classList.add('active');
    });
  });

  function startDashboard() {
    fetchLiveProgress();
    loadQuestions();
    loadSettings();
    if (!pollInterval) {
      pollInterval = setInterval(fetchLiveProgress, 3000); // Live poll every 3 seconds
    }
  }

  // 1. Live Student Progress Fetch & Render
  async function fetchLiveProgress() {
    if (!teacherToken) return;

    try {
      const res = await fetch('/api/teacher/students', {
        headers: { 'x-teacher-token': teacherToken }
      });
      const data = await res.json();
      if (!data.success) return;

      const { summary, students, isExamLive } = data;
      isCurrentExamLive = Boolean(isExamLive);

      // Update Master Switch UI
      if (masterStatusBadge && toggleExamLiveBtn) {
        if (isCurrentExamLive) {
          masterStatusBadge.className = 'badge badge-green';
          masterStatusBadge.innerHTML = '🟢 EXAM IS LIVE (LOGINS ALLOWED)';
          if (masterStatusDesc) masterStatusDesc.textContent = 'Students can log in and take their assessment.';
          toggleExamLiveBtn.className = 'btn btn-danger';
          toggleExamLiveBtn.innerHTML = '⏹️ END / CLOSE EXAMINATION';
        } else {
          masterStatusBadge.className = 'badge badge-amber';
          masterStatusBadge.innerHTML = '🔴 EXAM CLOSED (LOGINS BLOCKED)';
          if (masterStatusDesc) masterStatusDesc.textContent = 'Students cannot log in until you click Start Exam.';
          toggleExamLiveBtn.className = 'btn btn-success';
          toggleExamLiveBtn.innerHTML = '▶️ START EXAMINATION (ALLOW LOGINS)';
        }
      }

      // Update KPIs
      kpiTotalStudents.textContent = summary.total;
      kpiInProgress.textContent = summary.inProgress;
      kpiLocked.textContent = summary.locked;
      kpiSubmitted.textContent = summary.submitted;

      renderProgressTable(students, summary.totalQuestions);
    } catch (err) {
      console.warn('Live poll error:', err);
    }
  }

  function renderProgressTable(students, totalQuestions) {
    tableBody.innerHTML = '';

    if (!students || students.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);">No students registered in roster. Upload student CSV to begin.</td></tr>`;
      return;
    }

    students.forEach(s => {
      const tr = document.createElement('tr');
      if (s.status === 'LOCKED') tr.className = 'row-locked';

      let statusBadge = '';
      let progressInfo = '';
      let timeLeftStr = '--';
      let actionHtml = '--';

      if (s.status === 'IN_PROGRESS') {
        statusBadge = `<span class="badge badge-green">IN PROGRESS</span>`;
        progressInfo = `Q#${s.currentIndex}/${totalQuestions} (${s.answeredCount} answered)`;
        const mins = Math.floor((s.remainingSeconds || 0) / 60);
        const secs = (s.remainingSeconds || 0) % 60;
        timeLeftStr = `${mins}m ${secs}s`;
      } else if (s.status === 'LOCKED') {
        statusBadge = `<span class="badge badge-red">LOCKED</span>`;
        progressInfo = `<span style="color:#b91c1c; font-size:0.8rem;">${s.lockReason || 'Page refreshed'}</span>`;
      } else if (s.status === 'SUBMITTED') {
        statusBadge = `<span class="badge badge-blue">SUBMITTED</span>`;
        progressInfo = `<strong>${s.score}/${totalQuestions}</strong> (${s.percentage}%) - ${s.isPassed ? 'PASSED' : 'FAILED'}`;
        timeLeftStr = 'Completed';
      } else {
        statusBadge = `<span class="badge" style="background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1;">NOT STARTED</span>`;
        progressInfo = 'Awaiting student login';
      }

      actionHtml = `
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
          ${s.status === 'LOCKED' ? `<button class="unlock-btn" onclick="window.unlockStudent('${s.studentId}')" title="Unlock locked account">🔓 Unlock</button>` : ''}
          <button class="btn btn-secondary" style="font-size:0.72rem; padding:4px 8px; min-height:28px;" onclick="window.resetStudentExam('${s.studentId}', '${s.name.replace(/'/g, "\\'")}')" title="Reset exam to fresh state">🔄 Reset Exam</button>
          <button class="btn btn-secondary" style="font-size:0.72rem; padding:4px 8px; min-height:28px;" onclick="window.resetStudentPassword('${s.studentId}', '${s.name.replace(/'/g, "\\'")}')" title="Generate new password">🔑 Reset Pass</button>
        </div>
      `;

      tr.innerHTML = `
        <td class="mono" style="font-weight:700;">${s.studentId}</td>
        <td><strong>${s.name}</strong></td>
        <td><code style="background:#f1f5f9; padding:3px 8px; border-radius:4px; font-weight:700; color:#0369a1;">${s.password}</code></td>
        <td>${statusBadge}</td>
        <td>${progressInfo}</td>
        <td class="mono">${timeLeftStr}</td>
        <td>
          <span class="badge ${s.violationCount > 0 ? 'badge-red' : 'badge-green'}">
            ${s.violationCount}
          </span>
        </td>
        <td>${actionHtml}</td>
      `;
      tableBody.appendChild(tr);
    });
  }

  // Global Unlock Student Handler
  window.unlockStudent = async function(studentId) {
    if (!confirm(`Unlock examination account for ${studentId}? The student will be able to resume immediately.`)) return;

    try {
      const res = await fetch('/api/teacher/students/unlock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-teacher-token': teacherToken
        },
        body: JSON.stringify({ studentId })
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        fetchLiveProgress();
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (err) {
      alert('Network error unlocking student.');
    }
  };

  // Global Reset Exam Handler
  window.resetStudentExam = async function(studentId, studentName) {
    if (!confirm(`⚠️ RESET EXAMINATION for ${studentName} (${studentId})?\n\nThis will completely clear their current answers, score, violations, and locks, allowing them to take the exam again fresh.`)) return;

    try {
      const res = await fetch('/api/teacher/students/reset-exam', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-teacher-token': teacherToken
        },
        body: JSON.stringify({ studentId })
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        fetchLiveProgress();
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (err) {
      alert('Network error resetting exam.');
    }
  };

  // Global Reset Password Handler
  window.resetStudentPassword = async function(studentId, studentName) {
    if (!confirm(`Generate a new system password for ${studentName} (${studentId})?`)) return;

    try {
      const res = await fetch('/api/teacher/students/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-teacher-token': teacherToken
        },
        body: JSON.stringify({ studentId })
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        fetchLiveProgress();
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (err) {
      alert('Network error resetting password.');
    }
  };

  // 2. CSV Student Enrollment
  importCsvBtn.addEventListener('click', async () => {
    const csvText = studentCsvTextarea.value.trim();
    if (!csvText) {
      alert('Please enter or upload student CSV text.');
      return;
    }

    const mode = document.querySelector('input[name="csvMode"]:checked').value;
    importCsvBtn.disabled = true;
    importCsvBtn.textContent = 'GENERATING PASSWORDS...';

    try {
      const res = await fetch('/api/teacher/students/import-csv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-teacher-token': teacherToken
        },
        body: JSON.stringify({ csvText, mode })
      });

      const data = await res.json();
      if (data.success) {
        alert(data.message);
        studentCsvTextarea.value = '';
        fetchLiveProgress();
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (err) {
      alert('Failed to process student CSV.');
    } finally {
      importCsvBtn.disabled = false;
      importCsvBtn.textContent = 'GENERATE PASSWORDS & SAVE ROSTER ➔';
    }
  });

  // Dropzone file handling
  studentDropzone.addEventListener('click', () => studentFileInput.click());
  studentFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        studentCsvTextarea.value = evt.target.result;
        alert('File loaded into editor. Click "Generate Passwords & Save Roster" to confirm.');
      };
      reader.readAsText(e.target.files[0]);
    }
  });

  // 3. Download Sheets
  downloadProgressSheetBtn.addEventListener('click', () => {
    window.location.href = `/api/teacher/export-progress?token=${encodeURIComponent(teacherToken)}`;
  });

  downloadCredsBtnTop.addEventListener('click', () => {
    window.location.href = `/api/teacher/students/export-credentials?token=${encodeURIComponent(teacherToken)}`;
  });

  // 4. Question Bank
  async function loadQuestions() {
    try {
      const res = await fetch('/api/teacher/questions', {
        headers: { 'x-teacher-token': teacherToken }
      });
      const data = await res.json();
      if (data.success) {
        qCountBadge.textContent = data.count;
        rawQuestionEditor.value = JSON.stringify(data.questions, null, 2);
      }
    } catch (err) {
      console.warn('Question load error:', err);
    }
  }

  saveQuestionsBtn.addEventListener('click', async () => {
    let parsed;
    try {
      parsed = JSON.parse(rawQuestionEditor.value);
    } catch (err) {
      alert('Invalid JSON in Question Editor.');
      return;
    }

    try {
      const res = await fetch('/api/teacher/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-teacher-token': teacherToken
        },
        body: JSON.stringify({ questions: parsed, mode: 'replace' })
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        loadQuestions();
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (err) {
      alert('Failed to save questions.');
    }
  });

  // 5. Settings
  async function loadSettings() {
    try {
      const res = await fetch('/api/quiz/info');
      const data = await res.json();
      if (data.success) {
        cfgTitle.value = data.examTitle;
        cfgDuration.value = data.durationMinutes;
        cfgViolations.value = data.violationLimit;
        cfgPassMark.value = data.passingScorePercent;
      }
    } catch (err) {
      console.warn('Settings load error:', err);
    }
  }

  saveSettingsBtn.addEventListener('click', async () => {
    const payload = {
      examTitle: cfgTitle.value.trim(),
      durationMinutes: Number(cfgDuration.value),
      violationLimit: Number(cfgViolations.value),
      passingScorePercent: Number(cfgPassMark.value)
    };
    if (cfgPasscode.value.trim()) {
      payload.teacherPasscode = cfgPasscode.value.trim();
    }

    try {
      const res = await fetch('/api/teacher/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-teacher-token': teacherToken
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        alert('Settings updated successfully!');
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (err) {
      alert('Failed to save settings.');
    }
  });
});

