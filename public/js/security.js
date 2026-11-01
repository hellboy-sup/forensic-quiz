/**
 * FORENSIC EXAM PROCTORING & ANTI-CHEATING SHIELD
 * Implements strict controls: DevTools traps, keyboard intercepts,
 * fullscreen monitoring, tab switch detection, and server telemetry.
 */

class ProctoringShield {
  constructor(options = {}) {
    this.sessionId = options.sessionId || null;
    this.violationLimit = options.violationLimit || 3;
    this.onViolation = options.onViolation || (() => {});
    this.onTerminated = options.onTerminated || (() => {});
    this.isFullscreenRequired = options.fullscreenRequired !== false;

    this.violationCount = 0;
    this.isExamActive = false;
    this.devToolsDetected = false;
    this.fullscreenGraceTimer = null;
    this.lastDevtoolsTrigger = 0;

    this.initProtections();
  }

  setSession(sessionId, violationLimit = 3) {
    this.sessionId = sessionId;
    this.violationLimit = violationLimit;
    this.isExamActive = true;
  }

  stop() {
    this.isExamActive = false;
    if (this.fullscreenGraceTimer) clearInterval(this.fullscreenGraceTimer);
  }

  initProtections() {
    // 1. Prevent Context Menu (Right Click)
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.isExamActive) {
        this.triggerViolation('RIGHT_CLICK_ATTEMPT', 'Right-click context menu is restricted.');
      }
      return false;
    }, false);

    // 2. Intercept Forbidden Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      if (!this.isExamActive) return;

      const key = e.key ? e.key.toUpperCase() : '';
      const keyCode = e.keyCode || e.which;

      // F12 (DevTools)
      if (key === 'F12' || keyCode === 123) {
        e.preventDefault();
        e.stopPropagation();
        this.triggerViolation('KEYBOARD_F12', 'Developer Tools shortcut (F12) intercepted.');
        return false;
      }

      // Ctrl+Shift+I / Cmd+Option+I (Inspect)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'I' || keyCode === 73)) {
        e.preventDefault();
        e.stopPropagation();
        this.triggerViolation('KEYBOARD_DEVTOOLS_INSPECT', 'Inspect shortcut intercepted.');
        return false;
      }

      // Ctrl+Shift+J / Cmd+Option+J (Console)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'J' || keyCode === 74)) {
        e.preventDefault();
        e.stopPropagation();
        this.triggerViolation('KEYBOARD_DEVTOOLS_CONSOLE', 'Console shortcut intercepted.');
        return false;
      }

      // Ctrl+Shift+C (Inspect Element)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'C' || keyCode === 67)) {
        e.preventDefault();
        e.stopPropagation();
        this.triggerViolation('KEYBOARD_DEVTOOLS_INSPECT_EL', 'Element selector shortcut intercepted.');
        return false;
      }

      // Ctrl+U (View Source)
      if ((e.ctrlKey || e.metaKey) && (key === 'U' || keyCode === 85)) {
        e.preventDefault();
        e.stopPropagation();
        this.triggerViolation('KEYBOARD_VIEW_SOURCE', 'View-source shortcut intercepted.');
        return false;
      }

      // Ctrl+S (Save Page)
      if ((e.ctrlKey || e.metaKey) && (key === 'S' || keyCode === 83)) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // Ctrl+P (Print Page)
      if ((e.ctrlKey || e.metaKey) && (key === 'P' || keyCode === 80)) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // Copy / Cut / Paste interception
      if ((e.ctrlKey || e.metaKey) && ['C', 'V', 'X'].includes(key)) {
        e.preventDefault();
        return false;
      }
    }, true);

    // 3. Prevent Copy, Cut, Paste events
    ['copy', 'cut', 'paste'].forEach(evtName => {
      document.addEventListener(evtName, (e) => {
        if (this.isExamActive) {
          e.preventDefault();
        }
      });
    });

    // 4. Tab Switching & Window Focus Loss Detection
    document.addEventListener('visibilitychange', () => {
      if (!this.isExamActive) return;
      if (document.visibilityState === 'hidden') {
        this.triggerViolation('TAB_SWITCH_AWAY', 'Application focus lost: Candidate switched tabs or minimized browser.');
      }
    });

    window.addEventListener('blur', () => {
      if (!this.isExamActive) return;
      // Slight delay to avoid spurious blur when interacting with system dialogs
      setTimeout(() => {
        if (!document.hasFocus() && this.isExamActive) {
          this.triggerViolation('WINDOW_FOCUS_LOST', 'Window focus lost. Secondary monitor or external app interaction.');
        }
      }, 250);
    });

    // 5. Fullscreen Exit Detection
    document.addEventListener('fullscreenchange', () => this.handleFullscreenChange());
    document.addEventListener('webkitfullscreenchange', () => this.handleFullscreenChange());

    // 6. Active DevTools Heuristics
    this.startDevToolsDetector();
  }

  // Handle Fullscreen Exit
  handleFullscreenChange() {
    if (!this.isExamActive || !this.isFullscreenRequired) return;

    const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
    const breachOverlay = document.getElementById('fullscreenBreachOverlay');

    if (!isFull) {
      if (breachOverlay) breachOverlay.style.display = 'flex';
      if (window.ForensicAudio) window.ForensicAudio.playAlarm();

      this.triggerViolation('FULLSCREEN_EXITED', 'Candidate exited mandatory full-screen lockdown.');

      let graceSeconds = 10;
      const graceEl = document.getElementById('fullscreenCountdown');
      if (graceEl) graceEl.textContent = graceSeconds;

      if (this.fullscreenGraceTimer) clearInterval(this.fullscreenGraceTimer);
      this.fullscreenGraceTimer = setInterval(() => {
        graceSeconds--;
        if (graceEl) graceEl.textContent = graceSeconds;
        if (graceSeconds <= 0) {
          clearInterval(this.fullscreenGraceTimer);
          this.triggerViolation('FULLSCREEN_NOT_RESTORED', 'Failed to restore fullscreen within grace threshold.');
        }
      }, 1000);
    } else {
      if (breachOverlay) breachOverlay.style.display = 'none';
      if (this.fullscreenGraceTimer) {
        clearInterval(this.fullscreenGraceTimer);
        this.fullscreenGraceTimer = null;
      }
    }
  }

  // Request Fullscreen
  async requestFullscreenLock() {
    try {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      } else if (docEl.webkitRequestFullscreen) {
        await docEl.webkitRequestFullscreen();
      }
      return true;
    } catch (err) {
      console.warn('Fullscreen request rejected or not supported:', err);
      return false;
    }
  }

  // DevTools detection via dimensional & getter traps
  startDevToolsDetector() {
    // A. Console Getter Trap
    const element = new Image();
    Object.defineProperty(element, 'id', {
      get: () => {
        const now = Date.now();
        if (this.isExamActive && (now - this.lastDevtoolsTrigger > 3000)) {
          this.lastDevtoolsTrigger = now;
          this.triggerViolation('DEVTOOLS_INSPECT_DETECTED', 'Browser inspection pipeline trigger.');
        }
      }
    });

    setInterval(() => {
      if (!this.isExamActive) return;
      // Trigger evaluation of getter when console is open
      console.log(element);
      console.clear();
    }, 2000);

    // B. Dimension Delta Trap
    setInterval(() => {
      if (!this.isExamActive) return;
      const widthDelta = window.outerWidth - window.innerWidth > 160;
      const heightDelta = window.outerHeight - window.innerHeight > 160;

      if ((widthDelta || heightDelta) && !document.fullscreenElement) {
        const now = Date.now();
        if (now - this.lastDevtoolsTrigger > 3000) {
          this.lastDevtoolsTrigger = now;
          this.triggerViolation('DEVTOOLS_WINDOW_DOCK', 'DevTools dock opened (viewport dimension mismatch).');
        }
      }
    }, 1500);
  }

  // Trigger violation and sync to server
  async triggerViolation(type, details) {
    if (!this.isExamActive || !this.sessionId) return;

    if (window.ForensicAudio) window.ForensicAudio.playAlarm();

    try {
      const res = await fetch('/api/quiz/violation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.sessionId,
          type,
          details,
          timestamp: Date.now()
        })
      });

      const data = await res.json();
      if (data.success) {
        this.violationCount = data.currentViolations;
        this.onViolation({
          type,
          details,
          count: data.currentViolations,
          max: data.maxViolations
        });

        if (data.terminated) {
          this.stop();
          this.onTerminated(data.reason);
        }
      }
    } catch (err) {
      console.error('Proctoring telemetry sync failed:', err);
    }
  }
}

window.ProctoringShield = ProctoringShield;
