export function waveformPeaks(audioBuffer, resolution) {
  const sampleCount = audioBuffer.length;
  const bins = Math.max(1, Math.min(sampleCount, Math.floor(resolution) || 1));
  const channels = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, channel) => audioBuffer.getChannelData(channel)
  );
  const peaks = new Float32Array(bins);

  for (let bin = 0; bin < bins; bin++) {
    const start = Math.floor((bin * sampleCount) / bins);
    const end = Math.max(start + 1, Math.floor(((bin + 1) * sampleCount) / bins));
    let peak = 0;
    for (const channel of channels) {
      for (let sample = start; sample < end; sample++) {
        peak = Math.max(peak, Math.abs(channel[sample]));
      }
    }
    peaks[bin] = peak;
  }

  return peaks;
}
