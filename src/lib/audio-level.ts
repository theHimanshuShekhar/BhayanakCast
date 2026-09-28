/**
 * How loud an audio track is right now, for the lobby's mic meter (and later, speaking rings on
 * tiles). Browser-only.
 */

/**
 * Call `onLevel` about once per animation frame with `track`'s loudness, 0 (silence) to 1.
 * Returns a function that stops listening (it never stops `track` itself).
 */
export function watchAudioLevel(track: MediaStreamTrack, onLevel: (level: number) => void) {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(new MediaStream([track]));
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let frame = requestAnimationFrame(function tick() {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    onLevel(levelOf(Math.sqrt(sum / samples.length)));
    frame = requestAnimationFrame(tick);
  });
  // Autoplay rules can start it suspended; the user just clicked, so this normally works.
  void context.resume().catch(() => {});
  return () => {
    cancelAnimationFrame(frame);
    source.disconnect();
    void context.close().catch(() => {});
  };
}

/** An RMS amplitude on a 0–1 scale that reads well as a meter: -60 dBFS is 0, 0 dBFS is 1. */
export function levelOf(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db + 60) / 60));
}
