export function normalizeTabStemCalibration(value = {}) {
  const delay = Number(value.delaySeconds);
  const rate = Number(value.ratePercent);
  return {
    delaySeconds: Math.max(0, Math.min(10, Number.isFinite(delay) ? delay : 0)),
    ratePercent: Math.max(-5, Math.min(5, Number.isFinite(rate) ? rate : 0)),
  };
}

export function audioTimeForScore(scoreSeconds, calibration) {
  return calibration.delaySeconds + Math.max(0, scoreSeconds);
}

export function scoreTimeForAudio(audioSeconds, calibration) {
  return Math.max(0, audioSeconds - calibration.delaySeconds);
}

export function isScorePositionSeek(previousSeconds, currentSeconds, elapsedSeconds, playbackRate, toleranceSeconds = 0.3) {
  const expectedDelta = Math.max(0, elapsedSeconds) * playbackRate;
  return Math.abs((currentSeconds - previousSeconds) - expectedDelta) > toleranceSeconds;
}
