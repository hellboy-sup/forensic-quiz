/**
 * FORENSIC EXAM PROCTORING & LOCK GUARDIAN
 * Completely silent. Handles refresh lock detection,
 * DevTools interception, warnings, and server telemetry.
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
    this.lastTriggerTime = 0;
    this.triggerCooldownMs = 2000; // 2 seconds debounce between warning increments

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

      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/student/lock', blob);
      } else {
        fetch('/api/student/lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        });
      }
    };

    window.addEventListener('beforeunload', () => {
      if (this.isExamActive) triggerLock();
    });

    window.addEventListener('pagehide', () => {
      if (this.isExamActive) triggerLock();
    });
  }

  initProtections() {
    // 1. Prevent Context Menu (Right Click Inspect)
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.isExamActive) {
        this.triggerViolation('DEVTOOLS_RIGHT_CLICK', 'Right-click context menu / Inspect is blocked.');
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
        this.triggerViolation('DEVTOOLS_F12', 'Developer Tools shortcut (F12) detected.');
        return false;
      }

      // Ctrl+Shift+I / Cmd+Option+I (Inspect)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'I' || keyCode === 73)) {
        e.preventDefault();
        e.stopPropagation();
        this.triggerViolation('DEVTOOLS_INSPECT', 'Inspect shortcut (Ctrl+Shift+I) detected.');
        return false;
      }

      // Ctrl+Shift+J / Cmd+Option+J (Console)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'J' || keyCode === 74)) {
        e.preventDefault();
        e.stopPropagation();
        this.triggerViolation('DEVTOOLS_CONSOLE', 'Console shortcut (Ctrl+Shift+J) detected.');
        return false;
      }

      // Ctrl+Shift+C (Inspect Element)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'C' || keyCode === 67)) {
        e.preventDefault();
        e.stopPropagation();
        this.triggerViolation('DEVTOOLS_ELEMENT_SELECT', 'Element selector shortcut (Ctrl+Shift+C) detected.');
        return false;
      }

      // Ctrl+U (View Source)
      if ((e.ctrlKey || e.metaKey) && (key === 'U' || keyCode === 85)) {
        e.preventDefault();
        e.stopPropagation();
        this.triggerViolation('DEVTOOLS_VIEW_SOURCE', 'View source shortcut (Ctrl+U) detected.');
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

    // 3. Tab Switching Monitor
    document.addEventListener('visibilitychange', () => {
      if (!this.isExamActive) return;
      if (document.visibilityState === 'hidden') {
        this.triggerViolation('TAB_SWITCH', 'Application focus lost: Student switched tabs or minimized.');
      }
    });

    window.addEventListener('blur', () => {
      if (!this.isExamActive) return;
      setTimeout(() => {
        if (!document.hasFocus() && this.isExamActive) {
          this.triggerViolation('WINDOW_BLUR', 'Window focus lost.');
        }
      }, 350);
    });

    // 4. DevTools Active Heuristics Traps
    this.startDevToolsDetector();
  }

  startDevToolsDetector() {
    // A. Console Object Getter Trap (Triggers when Console / Elements panel evaluates objects)
    const element = new Image();
    Object.defineProperty(element, 'id', {
      get: () => {
        if (this.isExamActive) {
          this.triggerViolation('DEVTOOLS_OPEN_INSPECT', 'Active Developer Tools inspector detected.');
        }
      }
    });

    setInterval(() => {
      if (!this.isExamActive) return;
      console.log(element);
      console.clear();
    }, 2000);

    // B. Viewport Dimension Delta Trap (Detects docked DevTools in browser)
    setInterval(() => {
      if (!this.isExamActive) return;
      if (window.innerWidth > 600) {
        const widthDelta = window.outerWidth - window.innerWidth > 160;
        const heightDelta = window.outerHeight - window.innerHeight > 160;
        if (widthDelta || heightDelta) {
          this.triggerViolation('DEVTOOLS_PANEL_OPEN', 'Developer Tools dock/panel opened.');
        }
      }
    }, 1500);

    // C. Debugger Execution Latency Trap
    setInterval(() => {
      if (!this.isExamActive) return;
      const start = performance.now();
      // eslint-disable-next-line no-debugger
      debugger;
      const diff = performance.now() - start;
      if (diff > 100) {
        this.triggerViolation('DEVTOOLS_DEBUGGER_PAUSE', 'Developer Tools breakpoint / debugger triggered.');
      }
    }, 2500);
  }

  async triggerViolation(type, details) {
    if (!this.isExamActive || !this.studentId) return;

    const now = Date.now();
    // Cooldown check so rapid events count as one warning step
    if (now - this.lastTriggerTime < this.triggerCooldownMs) {
      return;
    }
    this.lastTriggerTime = now;

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
          max: data.maxViolations,
          locked: data.locked,
          lockReason: data.lockReason
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
