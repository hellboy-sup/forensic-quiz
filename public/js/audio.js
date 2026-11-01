/**
 * Audio Engine completely disabled as requested.
 * All sound triggers are silent stubs.
 */
window.ForensicAudio = {
  isMuted: true,
  init: () => {},
  toggleMute: () => true,
  playClick: () => {},
  playNav: () => {},
  playAlarm: () => {},
  playSuccess: () => {}
};
