/** Share in-flight decoding and peaks across selections and editor remounts. */
const peaks = new Map<string, Promise<number[]>>();
export function waveform(src: string, bars = 90): Promise<number[]> {
  const key = `${bars}:${src}`;
  const found = peaks.get(key);
  if (found) return found;
  const pending = (async () => {
    const response = await fetch(src);
    if (!response.ok) throw new Error("Sound unavailable");
    const buffer = await response.arrayBuffer();
    const context = new AudioContext();
    try {
      const audio = await context.decodeAudioData(buffer);
      const data = audio.getChannelData(0);
      const values = Array.from({ length: bars }, (_, i) => {
        const lo = Math.floor(i * data.length / bars);
        const hi = Math.floor((i + 1) * data.length / bars);
        let sum = 0, count = 0;
        for (let j = lo; j < hi; j += 16) { sum += Math.abs(data[j]); count++; }
        return count ? sum / count : 0;
      });
      const max = Math.max(...values, 0.0001);
      return values.map((v) => 0.15 + 0.85 * v / max);
    } finally { await context.close(); }
  })();
  peaks.set(key, pending);
  if (peaks.size > 24) peaks.delete(peaks.keys().next().value!);
  void pending.catch(() => peaks.delete(key));
  return pending;
}
