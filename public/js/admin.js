/**
 * ADMIN CONTROLLER - MANAGEMENT CONSOLE
 */

document.addEventListener('DOMContentLoaded', () => {
  let adminPasscode = sessionStorage.getItem('forensic_admin_passcode') || '';

  // DOM Elements
  const authGate = document.getElementById('authGate');
  const passcodeInput = document.getElementById('passcodeInput');
  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');
  const logoutBtn = document.getElementById('logoutBtn');

  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  // KPIs
  const kpiTotalAttempts = document.getElementById('kpiTotalAttempts');
  const kpiPassRate = document.getElementById('kpiPassRate');
  const kpiAvgScore = document.getElementById('kpiAvgScore');
  const kpiFlags = document.getElementById('kpiFlags');
  const kpiTotalQuestions = document.getElementById('kpiTotalQuestions');

  // Submissions
  const submissionsTableBody = document.getElementById('submissionsTableBody');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const clearSubmissionsBtn = document.getElementById('clearSubmissionsBtn');

  // Question Management
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const rawJsonEditor = document.getElementById('rawJsonEditor');
  const saveQuestionsBtn = document.getElementById('saveQuestionsBtn');
  const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');
  const previewCount = document.getElementById('previewCount');
  const questionsPreviewList = document.getElementById('questionsPreviewList');

  // Config
  const cfgTitle = document.getElementById('cfgTitle');
  const cfgCode = document.getElementById('cfgCode');
  const cfgDuration = document.getElementById('cfgDuration');
  const cfgViolations = document.getElementById('cfgViolations');
  const cfgPassMark = document.getElementById('cfgPassMark');
  const cfgPasscode = document.getElementById('cfgPasscode');
  const cfgRandomQuestions = document.getElementById('cfgRandomQuestions');
  const cfgRandomOptions = document.getElementById('cfgRandomOptions');
  const saveConfigBtn = document.getElementById('saveConfigBtn');

  // Passcode Check
  if (adminPasscode) {
    verifyPasscode(adminPasscode);
  }

  loginBtn.addEventListener('click', () => {
    const code = passcodeInput.value.trim();
    if (code) verifyPasscode(code);
  });

  passcodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const code = passcodeInput.value.trim();
      if (code) verifyPasscode(code);
    }
  });

  logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem('forensic_admin_passcode');
    adminPasscode = '';
    authGate.style.display = 'flex';
  });

  async function verifyPasscode(code) {
    try {
      const res = await fetch('/api/admin/overview', {
        headers: { 'x-admin-passcode': code }
      });
      const data = await res.json();
      if (data.success) {
        adminPasscode = code;
        sessionStorage.setItem('forensic_admin_passcode', code);
        authGate.style.display = 'none';
        loginError.style.display = 'none';
        loadDashboard(data);
        loadQuestions();
      } else {
        loginError.style.display = 'block';
        loginError.textContent = 'Clearance Denied: Invalid Passcode.';
      }
    } catch (err) {
      console.error(err);
      loginError.style.display = 'block';
      loginError.textContent = 'Server connection error.';
    }
  }

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const targetPane = document.getElementById(btn.dataset.tab);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // Load Dashboard Data
  function loadDashboard(data) {
    const { metrics, config, submissions } = data;

    // KPIs
    kpiTotalAttempts.textContent = metrics.totalAttempts;
    kpiPassRate.textContent = metrics.totalAttempts > 0 
      ? `${Math.round((metrics.passedAttempts / metrics.totalAttempts) * 100)}%` 
      : '0%';
    kpiAvgScore.textContent = `${metrics.avgScore}%`;
    kpiFlags.textContent = metrics.flaggedAttempts;
    kpiTotalQuestions.textContent = metrics.totalQuestions;

    // Populate Settings
    if (config) {
      cfgTitle.value = config.examTitle || '';
      cfgCode.value = config.examCode || '';
      cfgDuration.value = config.durationMinutes || 15;
      cfgViolations.value = config.violationLimit || 3;
      cfgPassMark.value = config.passingScorePercent || 70;
      cfgRandomQuestions.checked = config.randomizeQuestions !== false;
      cfgRandomOptions.checked = config.randomizeOptions !== false;
    }

    // Populate Submissions Table
    renderSubmissions(submissions);
  }

  function renderSubmissions(submissions) {
    submissionsTableBody.innerHTML = '';
    if (!submissions || submissions.length === 0) {
      submissionsTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px;" class="mono text-muted">No candidate examination submissions recorded yet.</td></tr>`;
      return;
    }

    submissions.forEach(s => {
      const tr = document.createElement('tr');
      const isCompromised = s.terminationReason || s.violationCount > 0;

      tr.innerHTML = `
        <td class="mono cyan" style="font-size:0.8rem;">${s.submissionId}</td>
        <td><strong>${s.candidate?.name || '--'}</strong></td>
        <td class="mono">${s.candidate?.id || '--'}</td>
        <td class="mono"><strong>${s.score}/${s.totalQuestions}</strong> (${s.percentage}%)</td>
        <td>
          <span class="badge ${s.isPassed ? 'badge-green' : 'badge-red'}">
            ${s.isPassed ? 'PASSED' : (s.terminationReason ? 'COMPROMISED' : 'FAILED')}
          </span>
        </td>
        <td>
          <span class="badge ${s.violationCount > 0 ? 'badge-red' : 'badge-green'}">
            ${s.violationCount} Violations
          </span>
        </td>
        <td class="mono text-muted" style="font-size:0.75rem;">${new Date(s.submittedAt).toLocaleString()}</td>
        <td class="mono text-muted" style="font-size:0.7rem; max-width:140px; overflow:hidden; text-overflow:ellipsis;" title="${s.verificationHash}">
          ${s.verificationHash?.substring(0, 16)}...
        </td>
      `;
      submissionsTableBody.appendChild(tr);
    });
  }

  // Load Questions Bank
  async function loadQuestions() {
    try {
      const res = await fetch('/api/admin/questions', {
        headers: { 'x-admin-passcode': adminPasscode }
      });
      const data = await res.json();
      if (data.success) {
        previewCount.textContent = data.count;
        rawJsonEditor.value = JSON.stringify(data.questions, null, 2);
        renderQuestionsPreview(data.questions);
      }
    } catch (err) {
      console.error('Failed to load questions:', err);
    }
  }

  function renderQuestionsPreview(questions) {
    questionsPreviewList.innerHTML = '';
    questions.forEach((q, idx) => {
      const item = document.createElement('div');
      item.style.cssText = 'background:rgba(0,0,0,0.3); padding:16px; border:1px solid var(--border-subtle); border-radius:var(--radius-sm);';
      
      const optionsHtml = q.options.map(opt => `
        <li style="margin-bottom:4px; color:${opt.id === q.correctOption ? 'var(--accent-green)' : 'var(--text-secondary)'}">
          <strong>[${opt.id}]</strong> ${opt.text} ${opt.id === q.correctOption ? '★ (CORRECT)' : ''}
        </li>
      `).join('');

      item.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span class="badge badge-cyan">${q.id || `Q-${idx + 1}`}</span>
          <span class="mono text-muted" style="font-size:0.75rem;">${q.category || 'General'}</span>
        </div>
        <div style="font-weight:600; margin-bottom:12px; font-size:0.95rem;">${q.question}</div>
        <ul style="list-style:none; padding-left:0; font-family:var(--font-mono); font-size:0.85rem; margin-bottom:10px;">
          ${optionsHtml}
        </ul>
        <div style="font-size:0.8rem; color:var(--text-muted); border-top:1px solid rgba(255,255,255,0.05); padding-top:8px;">
          <strong class="cyan">Explanation:</strong> ${q.explanation || 'None provided.'}
        </div>
      `;
      questionsPreviewList.appendChild(item);
    });
  }

  // Save Questions
  saveQuestionsBtn.addEventListener('click', async () => {
    let parsed;
    try {
      parsed = JSON.parse(rawJsonEditor.value);
      if (!Array.isArray(parsed)) throw new Error('Question data must be a JSON array of objects.');
    } catch (err) {
      alert(`Invalid JSON format: ${err.message}`);
      return;
    }

    const mode = document.querySelector('input[name="uploadMode"]:checked').value;

    saveQuestionsBtn.disabled = true;
    saveQuestionsBtn.textContent = 'SAVING QUESTION BANK...';

    try {
      const res = await fetch('/api/admin/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-passcode': adminPasscode
        },
        body: JSON.stringify({ questions: parsed, mode })
      });

      const data = await res.json();
      if (data.success) {
        alert(data.message);
        loadQuestions();
        refreshOverview();
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (err) {
      alert('Network error updating questions.');
    } finally {
      saveQuestionsBtn.disabled = false;
      saveQuestionsBtn.textContent = 'SAVE QUESTION BANK ➔';
    }
  });

  // File Dropzone Handling
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  function handleFile(file) {
    if (!file.name.endsWith('.json')) {
      alert('Please upload a valid .json file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        rawJsonEditor.value = JSON.stringify(json, null, 2);
        alert(`File "${file.name}" loaded into editor. Review and click "Save Question Bank".`);
      } catch (err) {
        alert(`Invalid JSON file content: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  // Template download
  downloadTemplateBtn.addEventListener('click', () => {
    const template = [
      {
        "id": "DF-201",
        "category": "Disk Forensics",
        "question": "What is the primary function of a hardware write-blocker during digital evidence acquisition?",
        "options": [
          { "id": "A", "text": "Prevents any write or modification commands from reaching the source disk" },
          { "id": "B", "text": "Speeds up disk cloning via SATA compression" },
          { "id": "C", "text": "Decrypts BitLocker volumes on the fly" },
          { "id": "D", "text": "Bypasses BIOS administrative boot passwords" }
        ],
        "correctOption": "A",
        "explanation": "Hardware write blockers intercept write signals at the hardware controller level to guarantee that original digital evidence cannot be altered."
      }
    ];

    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'forensic_questions_template.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Save Settings
  saveConfigBtn.addEventListener('click', async () => {
    const payload = {
      examTitle: cfgTitle.value.trim(),
      examCode: cfgCode.value.trim(),
      durationMinutes: Number(cfgDuration.value),
      violationLimit: Number(cfgViolations.value),
      passingScorePercent: Number(cfgPassMark.value),
      randomizeQuestions: cfgRandomQuestions.checked,
      randomizeOptions: cfgRandomOptions.checked
    };

    if (cfgPasscode.value.trim()) {
      payload.adminPasscode = cfgPasscode.value.trim();
    }

    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-passcode': adminPasscode
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        if (payload.adminPasscode) {
          adminPasscode = payload.adminPasscode;
          sessionStorage.setItem('forensic_admin_passcode', adminPasscode);
        }
        alert('Assessment configuration saved successfully!');
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (err) {
      alert('Failed to save configuration.');
    }
  });

  // Export CSV
  exportCsvBtn.addEventListener('click', () => {
    window.location.href = `/api/admin/export?passcode=${encodeURIComponent(adminPasscode)}`;
  });

  // Clear Submissions
  clearSubmissionsBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to permanently delete all candidate examination submission logs?')) return;

    try {
      const res = await fetch('/api/admin/submissions/clear', {
        method: 'POST',
        headers: { 'x-admin-passcode': adminPasscode }
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        refreshOverview();
      }
    } catch (err) {
      alert('Failed to clear submissions.');
    }
  });

  async function refreshOverview() {
    try {
      const res = await fetch('/api/admin/overview', {
        headers: { 'x-admin-passcode': adminPasscode }
      });
      const data = await res.json();
      if (data.success) {
        loadDashboard(data);
      }
    } catch (err) {
      console.error(err);
    }
  }
});
