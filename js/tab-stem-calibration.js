export function normalizeTabStemCalibration(value = {}) {
  const delay = Number(value.delaySeconds);
  const rate = Number(value.ratePercent);
  return {
    delaySeconds: Math.max(0, Math.min(10, Number.isFinite(delay) ? delay : 0)),
    ratePercent: Math.max(-5, Math.min(5, Number.isFinite(rate) ? rate : 0)),
  };
}

export function audioTimeForScore(scoreSeconds, calibration, playbackRate = 1) {
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  return calibration.delaySeconds + Math.max(0, scoreSeconds) * rate;
}

export function scoreTimeForAudio(audioSeconds, calibration, playbackRate = 1) {
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  return Math.max(0, audioSeconds - calibration.delaySeconds) / rate;
}

export function isScorePositionSeek(previousSeconds, currentSeconds, elapsedSeconds, playbackRate, toleranceSeconds = 0.3) {
  const expectedDelta = Math.max(0, elapsedSeconds) * playbackRate;
  return Math.abs((currentSeconds - previousSeconds) - expectedDelta) > toleranceSeconds;
}
