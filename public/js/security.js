/**
 * FORENSIC EXAM PROCTORING & LOCK GUARDIAN
 * Completely silent. Handles refresh lock detection,
 * DevTools interception, and server telemetry.
 */

class ProctoringShield {
  constructor(options = {}) {
    this.studentId = options.studentId || null;
    this.sessionId = options.sessionId || null;
    this.violationLimit = options.violationLimit || 3;
    this.onViolation = options.onViolation || (() => {});
    this.onLocked = options.onLocked || (() => {});
    this.getStateCallback = options.getStateCallback || (() => ({}));

    this.isExamActive = false;
    this.lastDevtoolsTrigger = 0;

    this.initProtections();
    this.initRefreshLockHandler();
  }

  setSession(studentId, sessionId, violationLimit = 3) {
    this.studentId = studentId;
    this.sessionId = sessionId;
    this.violationLimit = violationLimit;
    this.isExamActive = true;
  }

  stop() {
    this.isExamActive = false;
  }

  // Detect and lock when student refreshes or exits
  initRefreshLockHandler() {
    const triggerLock = () => {
      if (!this.isExamActive || !this.studentId) return;

      const state = this.getStateCallback();
      const payload = JSON.stringify({
        studentId: this.studentId,
        reason: 'Page refreshed or browser window closed',
        currentAnswers: state.currentAnswers || {},
        currentIndex: state.currentIndex || 0,
        remainingSeconds: state.remainingSeconds || 0
      });

      // Use navigator.sendBeacon for reliable delivery during unload/refresh
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/student/lock', blob);
      } else {
        // Fallback sync fetch
        fetch('/api/student/lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        });
      }
    };

    window.addEventListener('beforeunload', (e) => {
      if (this.isExamActive) {
        triggerLock();
      }
    });

    window.addEventListener('pagehide', (e) => {
      if (this.isExamActive) {
        triggerLock();
      }
    });
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

      // Ctrl+S / Ctrl+P
      if ((e.ctrlKey || e.metaKey) && ['S', 'P'].includes(key)) {
        e.preventDefault();
        return false;
      }

      // Copy / Cut / Paste interception
      if ((e.ctrlKey || e.metaKey) && ['C', 'V', 'X'].includes(key)) {
        e.preventDefault();
        return false;
      }
    }, true);

    // 3. Tab & Visibility Monitor
    document.addEventListener('visibilitychange', () => {
      if (!this.isExamActive) return;
      if (document.visibilityState === 'hidden') {
        this.triggerViolation('TAB_SWITCH_AWAY', 'Application focus lost: Candidate switched tabs or minimized.');
      }
    });

    window.addEventListener('blur', () => {
      if (!this.isExamActive) return;
      setTimeout(() => {
        if (!document.hasFocus() && this.isExamActive) {
          this.triggerViolation('WINDOW_BLUR', 'Window focus lost.');
        }
      }, 300);
    });

    // 4. DevTools Trap
    this.startDevToolsDetector();
  }

  startDevToolsDetector() {
    const element = new Image();
    Object.defineProperty(element, 'id', {
      get: () => {
        const now = Date.now();
        if (this.isExamActive && (now - this.lastDevtoolsTrigger > 3000)) {
          this.lastDevtoolsTrigger = now;
          this.triggerViolation('DEVTOOLS_INSPECT_DETECTED', 'Browser inspector opened.');
        }
      }
    });

    setInterval(() => {
      if (!this.isExamActive) return;
      console.log(element);
      console.clear();
    }, 2500);

    // Dimension Trap (desktop only)
    setInterval(() => {
      if (!this.isExamActive) return;
      if (window.innerWidth > 768) {
        const widthDelta = window.outerWidth - window.innerWidth > 160;
        const heightDelta = window.outerHeight - window.innerHeight > 160;
        if (widthDelta || heightDelta) {
          const now = Date.now();
          if (now - this.lastDevtoolsTrigger > 3000) {
            this.lastDevtoolsTrigger = now;
            this.triggerViolation('DEVTOOLS_DOCK', 'DevTools dock opened.');
          }
        }
      }
    }, 2000);
  }

  async triggerViolation(type, details) {
    if (!this.isExamActive || !this.studentId) return;

    try {
      const res = await fetch('/api/student/violation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: this.studentId,
          type,
          details
        })
      });

      const data = await res.json();
      if (data.success) {
        this.onViolation({
          type,
          details,
          count: data.currentViolations,
          max: data.maxViolations
        });

        if (data.locked) {
          this.stop();
          this.onLocked(data.lockReason);
        }
      }
    } catch (err) {
      console.error('Telemetry error:', err);
    }
  }
}

window.ProctoringShield = ProctoringShield;
