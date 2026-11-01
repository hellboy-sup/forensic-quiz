/**
 * EXAM CONTROLLER - PROGRESS RESTORATION & RESUME ENGINE
 * Completely silent. Handles answers, timer, auto-sync, and lock states.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const rawSession = sessionStorage.getItem('forensic_active_session');
  if (!rawSession) {
    alert('No active session found. Redirecting to student login.');
    window.location.href = '/index.html';
    return;
  }

  const session = JSON.parse(rawSession);
  const questions = session.questions || [];
  const student = session.student;
  const sessionId = session.sessionId;

  // Restore State from Session / Server
  let currentIndex = session.currentIndex || 0;
  let remainingSeconds = session.remainingSeconds || (session.durationMinutes * 60);
  const userAnswers = new Map(Object.entries(session.currentAnswers || {}));
  const flaggedQuestions = new Set();
  let isSubmitting = false;

  // DOM Elements
  const examTitleEl = document.getElementById('examTitle');
  const candidateNameEl = document.getElementById('candidateName');
  const candidateIdEl = document.getElementById('candidateId');
  const timerDisplayEl = document.getElementById('timerDigits');
  const violationBadgeEl = document.getElementById('violationBadge');

  const questionNumEl = document.getElementById('questionNum');
  const totalQuestionsEl = document.getElementById('totalQuestions');
  const artifactCategoryEl = document.getElementById('artifactCategory');
  const artifactIdEl = document.getElementById('artifactId');
  const questionPromptEl = document.getElementById('questionPrompt');
  const optionsContainerEl = document.getElementById('optionsContainer');

  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const flagBtn = document.getElementById('flagBtn');
  const submitExamBtn = document.getElementById('submitExamBtn');
  const matrixGridEl = document.getElementById('matrixGrid');

  const submitModal = document.getElementById('submitConfirmModal');
  const confirmSubmitBtn = document.getElementById('confirmSubmitBtn');
  const cancelSubmitBtn = document.getElementById('cancelSubmitBtn');
  const answeredCountEl = document.getElementById('modalAnsweredCount');
  const remainingCountEl = document.getElementById('modalRemainingCount');

  const lockOverlay = document.getElementById('lockOverlay');
  const lockReasonText = document.getElementById('lockReasonText');

  const securityWarningModal = document.getElementById('securityWarningModal');
  const warningIcon = document.getElementById('warningIcon');
  const warningTitleText = document.getElementById('warningTitleText');
  const warningCountBadge = document.getElementById('warningCountBadge');
  const warningDetailsText = document.getElementById('warningDetailsText');
  const warningRemainingText = document.getElementById('warningRemainingText');
  const ackWarningBtn = document.getElementById('ackWarningBtn');

  if (ackWarningBtn && securityWarningModal) {
    ackWarningBtn.addEventListener('click', () => {
      securityWarningModal.classList.remove('active');
    });
  }

  // Populate Header
  if (examTitleEl) examTitleEl.textContent = session.examTitle || 'Forensic Assessment';
  if (candidateNameEl) candidateNameEl.textContent = student.name;
  if (candidateIdEl) candidateIdEl.textContent = student.studentId;
  if (totalQuestionsEl) totalQuestionsEl.textContent = questions.length;

  // Proctoring Shield
  const shield = new window.ProctoringShield({
    studentId: student.studentId,
    sessionId: sessionId,
    violationLimit: session.violationLimit || 3,
    getStateCallback: () => ({
      currentAnswers: Object.fromEntries(userAnswers),
      currentIndex,
      remainingSeconds
    }),
    onViolation: (v) => {
      if (violationBadgeEl) {
        violationBadgeEl.textContent = `VIOLATIONS: ${v.count}/${v.max}`;
        if (v.count > 0) violationBadgeEl.className = 'badge badge-red';
      }

      // Check violation type: Tab Switch vs DevTools
      const isTabSwitch = (v.type || '').includes('TAB') || (v.type || '').includes('BLUR');

      // If under limit, display the appropriate warning popup
      if (v.count < v.max && !v.locked) {
        if (securityWarningModal) {
          if (warningIcon) warningIcon.textContent = isTabSwitch ? '👁️' : '🚨';
          if (warningTitleText) {
            warningTitleText.textContent = isTabSwitch 
              ? 'TAB SWITCH DETECTED' 
              : 'DEVELOPER TOOLS / INSPECT DETECTED';
          }
          if (warningCountBadge) warningCountBadge.textContent = `WARNING ${v.count} OF ${v.max}`;
          if (warningDetailsText) {
            warningDetailsText.textContent = isTabSwitch
              ? 'Switching browser tabs or minimizing the window is prohibited during the examination.'
              : (v.details || 'Opening Developer Tools, Inspect Element, or page source is prohibited.');
          }
          if (warningRemainingText) {
            const remaining = v.max - v.count;
            warningRemainingText.textContent = isTabSwitch
              ? `⚠️ NOTICE: You have ${remaining} warning${remaining > 1 ? 's' : ''} remaining. On 3 tab switches, your exam will be LOCKED.`
              : `⚠️ NOTICE: You have ${remaining} warning${remaining > 1 ? 's' : ''} remaining. On 3 warnings, your exam will be LOCKED.`;
          }
          securityWarningModal.classList.add('active');
        }
      } else {
        // Warning 3 or locked: Close warning modal and immediately display full lock screen
        if (securityWarningModal) securityWarningModal.classList.remove('active');
        const lockMsg = isTabSwitch 
          ? `Exceeded permitted security warnings (${v.count}/${v.max}): 3 Tab switches / window minimizes detected.`
          : (v.lockReason || `Exceeded permitted security warnings (${v.count}/${v.max}): Developer Tools access detected.`);
        showLockScreen(lockMsg);
      }
    },
    onLocked: (reason) => {
      if (securityWarningModal) securityWarningModal.classList.remove('active');
      showLockScreen(reason);
    }
  });

  shield.setSession(student.studentId, sessionId, session.violationLimit || 3);

  function showLockScreen(reason) {
    if (lockOverlay) {
      if (lockReasonText) lockReasonText.textContent = reason || 'Session locked by supervisor.';
      lockOverlay.style.display = 'flex';
    }
  }

  // Periodic Server Progress Sync
  async function syncProgress() {
    if (isSubmitting) return;
    try {
      await fetch('/api/student/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.studentId,
          currentAnswers: Object.fromEntries(userAnswers),
          currentIndex,
          remainingSeconds
        })
      });

      // Update local session storage
      session.currentAnswers = Object.fromEntries(userAnswers);
      session.currentIndex = currentIndex;
      session.remainingSeconds = remainingSeconds;
      sessionStorage.setItem('forensic_active_session', JSON.stringify(session));
    } catch (err) {
      console.warn('Sync failed:', err);
    }
  }

  // Sync every 8 seconds
  const syncInterval = setInterval(syncProgress, 8000);

  // Build Matrix Palette
  function buildMatrix() {
    matrixGridEl.innerHTML = '';
    questions.forEach((q, idx) => {
      const btn = document.createElement('button');
      btn.className = 'matrix-btn';
      btn.textContent = idx + 1;
      btn.dataset.index = idx;
      btn.addEventListener('click', () => goToQuestion(idx));
      matrixGridEl.appendChild(btn);
    });
    updateMatrixState();
  }

  function updateMatrixState() {
    const buttons = matrixGridEl.querySelectorAll('.matrix-btn');
    buttons.forEach((btn, idx) => {
      const q = questions[idx];
      btn.classList.toggle('active', idx === currentIndex);
      btn.classList.toggle('answered', userAnswers.has(q.id));
      btn.classList.toggle('flagged', flaggedQuestions.has(q.id));
    });
  }

  // Render Current Question
  function renderCurrentQuestion() {
    const q = questions[currentIndex];
    if (!q) return;

    if (questionNumEl) questionNumEl.textContent = currentIndex + 1;
    if (artifactCategoryEl) artifactCategoryEl.textContent = q.category || 'General Forensics';
    if (artifactIdEl) artifactIdEl.textContent = `ARTIFACT // ${q.id}`;
    if (questionPromptEl) questionPromptEl.textContent = q.question;

    optionsContainerEl.innerHTML = '';
    const selectedOption = userAnswers.get(q.id);

    q.options.forEach((opt, optIndex) => {
      const card = document.createElement('div');
      card.className = 'option-card';
      if (selectedOption === opt.id) {
        card.classList.add('selected');
      }

      const letterBadge = document.createElement('div');
      letterBadge.className = 'option-letter';
      letterBadge.textContent = opt.id || String.fromCharCode(65 + optIndex);

      const textSpan = document.createElement('div');
      textSpan.className = 'option-text';
      textSpan.textContent = opt.text;

      card.appendChild(letterBadge);
      card.appendChild(textSpan);

      card.addEventListener('click', () => {
        userAnswers.set(q.id, opt.id);
        renderCurrentQuestion();
        updateMatrixState();
        syncProgress();
      });

      optionsContainerEl.appendChild(card);
    });

    // Update Nav Buttons
    if (prevBtn) prevBtn.disabled = currentIndex === 0;
    if (nextBtn) {
      if (currentIndex === questions.length - 1) {
        nextBtn.textContent = 'Review & Finish ➔';
      } else {
        nextBtn.textContent = 'Next Question ➔';
      }
    }

    if (flagBtn) {
      const isFlagged = flaggedQuestions.has(q.id);
      flagBtn.classList.toggle('btn-primary', isFlagged);
      flagBtn.textContent = isFlagged ? '★ Flagged' : '☆ Mark for Review';
    }

    updateMatrixState();
  }

  function goToQuestion(idx) {
    if (idx >= 0 && idx < questions.length) {
      currentIndex = idx;
      renderCurrentQuestion();
      syncProgress();
    }
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentIndex > 0) goToQuestion(currentIndex - 1);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (currentIndex < questions.length - 1) {
        goToQuestion(currentIndex + 1);
      } else {
        openSubmitModal();
      }
    });
  }

  if (flagBtn) {
    flagBtn.addEventListener('click', () => {
      const q = questions[currentIndex];
      if (flaggedQuestions.has(q.id)) {
        flaggedQuestions.delete(q.id);
      } else {
        flaggedQuestions.add(q.id);
      }
      renderCurrentQuestion();
    });
  }

  // Submit Modal Logic
  if (submitExamBtn) {
    submitExamBtn.addEventListener('click', () => openSubmitModal());
  }

  function openSubmitModal() {
    const answeredCount = userAnswers.size;
    const remainingCount = questions.length - answeredCount;

    if (answeredCountEl) answeredCountEl.textContent = answeredCount;
    if (remainingCountEl) remainingCountEl.textContent = remainingCount;
    if (submitModal) submitModal.classList.add('active');
  }

  if (cancelSubmitBtn) {
    cancelSubmitBtn.addEventListener('click', () => {
      if (submitModal) submitModal.classList.remove('active');
    });
  }

  if (confirmSubmitBtn) {
    confirmSubmitBtn.addEventListener('click', () => {
      if (submitModal) submitModal.classList.remove('active');
      submitExam();
    });
  }

  // Timer Countdown
  const timerInterval = setInterval(() => {
    remainingSeconds = Math.max(0, remainingSeconds - 1);

    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    if (timerDisplayEl) {
      timerDisplayEl.textContent = formatted;
      if (remainingSeconds <= 120) {
        timerDisplayEl.className = 'timer-digits danger';
      } else if (remainingSeconds <= 300) {
        timerDisplayEl.className = 'timer-digits warning';
      } else {
        timerDisplayEl.className = 'timer-digits';
      }
    }

    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      clearInterval(syncInterval);
      if (!isSubmitting) {
        alert('Time expired. Automatically submitting assessment.');
        submitExam();
      }
    }
  }, 1000);

  // Submit Final Answers to Server
  async function submitExam() {
    if (isSubmitting) return;
    isSubmitting = true;
    shield.stop();
    clearInterval(timerInterval);
    clearInterval(syncInterval);

    try {
      const res = await fetch('/api/student/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.studentId,
          answers: Object.fromEntries(userAnswers)
        })
      });

      const result = await res.json();
      if (result.success) {
        sessionStorage.removeItem('forensic_active_session');
        sessionStorage.setItem('forensic_last_result', JSON.stringify(result.data));
        window.location.href = '/result.html';
      } else {
        alert(`Error: ${result.message}`);
        isSubmitting = false;
      }
    } catch (err) {
      console.error('Submission failed:', err);
      alert('Network error submitting assessment.');
      isSubmitting = false;
    }
  }

  // Initialize
  buildMatrix();
  renderCurrentQuestion();
});
