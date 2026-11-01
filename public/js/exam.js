/**
 * EXAM CONTROLLER - CORE CLIENT ENGINE
 * Handles question state, timer countdown, responses, and submissions.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Retrieve session data
  const rawSession = sessionStorage.getItem('forensic_active_session');
  if (!rawSession) {
    alert('No active forensic examination session found. Redirecting to initialization.');
    window.location.href = '/index.html';
    return;
  }

  const session = JSON.parse(rawSession);
  const questions = session.questions || [];
  const sessionId = session.sessionId;

  if (questions.length === 0) {
    alert('Assessment contains no questions. Contact administrator.');
    window.location.href = '/index.html';
    return;
  }

  // State
  let currentIndex = 0;
  const userAnswers = new Map(); // questionId -> optionId
  const flaggedQuestions = new Set(); // Set of questionIds
  let isSubmitting = false;

  // DOM Elements
  const examTitleEl = document.getElementById('examTitle');
  const examCodeEl = document.getElementById('examCode');
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

  const audioToggleBtn = document.getElementById('audioToggleBtn');
  const reenterFullscreenBtn = document.getElementById('reenterFullscreenBtn');
  const terminationModal = document.getElementById('terminationModal');
  const terminationReasonEl = document.getElementById('terminationReasonText');

  // Populate Header HUD
  if (examTitleEl) examTitleEl.textContent = session.examTitle || 'Forensic Assessment';
  if (examCodeEl) examCodeEl.textContent = session.examCode || 'DFIR-BENCHMARK';
  if (candidateNameEl) candidateNameEl.textContent = session.candidate.name;
  if (candidateIdEl) candidateIdEl.textContent = session.candidate.id;
  if (totalQuestionsEl) totalQuestionsEl.textContent = questions.length;

  // Audio Toggle
  if (audioToggleBtn) {
    audioToggleBtn.addEventListener('click', () => {
      const isMuted = window.ForensicAudio.toggleMute();
      audioToggleBtn.textContent = isMuted ? '🔇 AUDIO OFF' : '🔊 AUDIO ON';
      audioToggleBtn.classList.toggle('active', !isMuted);
    });
    audioToggleBtn.textContent = window.ForensicAudio.isMuted ? '🔇 AUDIO OFF' : '🔊 AUDIO ON';
  }

  // Initialize Proctoring Shield
  const shield = new window.ProctoringShield({
    sessionId: sessionId,
    violationLimit: session.violationLimit || 3,
    onViolation: (violation) => {
      updateViolationUI(violation.count, violation.max);
      appendSecurityLog(violation.type, violation.details);
    },
    onTerminated: (reason) => {
      handleSecurityTermination(reason);
    }
  });
  shield.setSession(sessionId, session.violationLimit || 3);

  // Re-enter Fullscreen handler
  if (reenterFullscreenBtn) {
    reenterFullscreenBtn.addEventListener('click', async () => {
      await shield.requestFullscreenLock();
    });
  }

  // Build Matrix Palette
  function buildMatrix() {
    matrixGridEl.innerHTML = '';
    questions.forEach((q, idx) => {
      const btn = document.createElement('button');
      btn.className = 'matrix-btn';
      btn.textContent = idx + 1;
      btn.dataset.index = idx;
      btn.addEventListener('click', () => {
        if (window.ForensicAudio) window.ForensicAudio.playNav();
        goToQuestion(idx);
      });
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
    if (artifactCategoryEl) artifactCategoryEl.textContent = q.category || 'General';
    if (artifactIdEl) artifactIdEl.textContent = `ARTIFACT // ${q.id}`;
    if (questionPromptEl) questionPromptEl.textContent = q.question;

    // Options
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
        if (window.ForensicAudio) window.ForensicAudio.playClick();
        userAnswers.set(q.id, opt.id);
        renderCurrentQuestion();
        updateMatrixState();
      });

      optionsContainerEl.appendChild(card);
    });

    // Update Nav Buttons
    if (prevBtn) prevBtn.disabled = currentIndex === 0;
    if (nextBtn) {
      if (currentIndex === questions.length - 1) {
        nextBtn.textContent = 'Review & Finish ➔';
      } else {
        nextBtn.textContent = 'Next Artifact ➔';
      }
    }

    // Flag status
    if (flagBtn) {
      const isFlagged = flaggedQuestions.has(q.id);
      flagBtn.classList.toggle('btn-primary', isFlagged);
      flagBtn.textContent = isFlagged ? '★ Artifact Flagged' : '☆ Mark for Review';
    }

    updateMatrixState();
  }

  function goToQuestion(idx) {
    if (idx >= 0 && idx < questions.length) {
      currentIndex = idx;
      renderCurrentQuestion();
    }
  }

  // Navigation handlers
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentIndex > 0) {
        if (window.ForensicAudio) window.ForensicAudio.playNav();
        goToQuestion(currentIndex - 1);
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (currentIndex < questions.length - 1) {
        if (window.ForensicAudio) window.ForensicAudio.playNav();
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
      submitExam(false);
    });
  }

  // Server-Enforced Chronometer
  const expiresAt = session.expiresAt;
  const timerInterval = setInterval(() => {
    const now = Date.now();
    const remainingMs = Math.max(0, expiresAt - now);
    const totalSeconds = Math.floor(remainingMs / 1000);

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    if (timerDisplayEl) {
      timerDisplayEl.textContent = formatted;

      if (totalSeconds <= 120) {
        timerDisplayEl.className = 'timer-digits danger';
      } else if (totalSeconds <= 300) {
        timerDisplayEl.className = 'timer-digits warning';
      } else {
        timerDisplayEl.className = 'timer-digits';
      }
    }

    if (remainingMs <= 0) {
      clearInterval(timerInterval);
      if (!isSubmitting) {
        alert('Time limit expired. Automatically submitting exam.');
        submitExam(true, 'TIME_EXPIRED');
      }
    }
  }, 1000);

  // Security UI updates
  function updateViolationUI(count, max) {
    if (violationBadgeEl) {
      violationBadgeEl.textContent = `SECURITY VIOLATIONS: ${count}/${max}`;
      if (count > 0) {
        violationBadgeEl.className = 'badge badge-red';
      }
    }
  }

  function appendSecurityLog(type, details) {
    const stream = document.getElementById('securityStream');
    if (!stream) return;

    const timeStr = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'stream-entry violation';
    entry.innerHTML = `<span class="stream-time">[${timeStr}]</span> <strong>[${type}]</strong>: ${details}`;
    stream.prepend(entry);
  }

  function handleSecurityTermination(reason) {
    if (isSubmitting) return;
    shield.stop();
    if (terminationModal) {
      if (terminationReasonEl) terminationReasonEl.textContent = reason || 'Integrity threshold breached.';
      terminationModal.classList.add('active');
    }
    // Auto submit compromised test after 3 seconds
    setTimeout(() => {
      submitExam(true, reason || 'EXCEEDED_SECURITY_VIOLATIONS');
    }, 2500);
  }

  // Submit Final Answers to Server
  async function submitExam(autoSubmitted = false, terminationReason = null) {
    if (isSubmitting) return;
    isSubmitting = true;
    shield.stop();
    clearInterval(timerInterval);

    // Format answers array
    const formattedAnswers = [];
    userAnswers.forEach((selectedOption, questionId) => {
      formattedAnswers.push({ questionId, selectedOption });
    });

    try {
      const res = await fetch('/api/quiz/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          answers: formattedAnswers,
          autoSubmitted,
          terminationReason
        })
      });

      const result = await res.json();
      if (result.success) {
        if (window.ForensicAudio) window.ForensicAudio.playSuccess();
        // Clear active session and store certified result
        sessionStorage.removeItem('forensic_active_session');
        sessionStorage.setItem('forensic_last_result', JSON.stringify(result.data));
        window.location.href = '/result.html';
      } else {
        alert(`Submission Error: ${result.message}`);
        isSubmitting = false;
      }
    } catch (err) {
      console.error('Submission failed:', err);
      alert('Network error submitting examination. Please notify examiner.');
      isSubmitting = false;
    }
  }

  // Initialize
  buildMatrix();
  renderCurrentQuestion();
});
