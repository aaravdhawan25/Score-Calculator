// Frame extraction happens entirely in the browser: the video file is never
// uploaded, only small JPEG stills are sent for analysis.

export function seek(video, t) {
  return new Promise((resolve, reject) => {
    const target = Math.max(0, Math.min(t, (video.duration || 0) - 0.05));
    if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= 2) return resolve();
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('This video could not be decoded by your browser. Try an MP4 (H.264).')); };
    const timer = setTimeout(done, 4000); // some codecs never fire `seeked` on the last frame
    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
    }
    video.addEventListener('seeked', done, { once: true });
    video.addEventListener('error', fail, { once: true });
    video.currentTime = target;
  });
}

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

export function grab(video, width = 768, quality = 0.72) {
  const scale = Math.min(1, width / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

function luma(video, w = 160) {
  const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) out[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return out;
}

/**
 * Find when robots start moving. Robots are small in a wide field shot, so
 * rather than average brightness change we count pixels that changed
 * noticeably, and look for the first sustained rise above the idle baseline
 * (sensor noise, compression shimmer).
 */
export async function detectStart(video, { limit = 60, step = 0.25, onProgress } = {}) {
  const end = Math.min(video.duration || 0, limit);
  const samples = [];
  let prev = null;
  for (let t = 0; t <= end; t += step) {
    await seek(video, t);
    const cur = luma(video);
    if (prev) {
      let changed = 0;
      for (let i = 0; i < cur.length; i++) if (Math.abs(cur[i] - prev[i]) > 18) changed++;
      samples.push({ t, d: changed });
    }
    prev = cur;
    onProgress?.(t / end);
  }
  if (samples.length < 8) return 0;
  const idle = samples.slice(0, Math.max(4, Math.round(2 / step))).map((x) => x.d).sort((a, b) => a - b);
  const baseline = idle[Math.floor(idle.length / 2)];
  const threshold = Math.max(baseline * 3, baseline + Math.max(6, prev.length * 0.0012));
  for (let i = 0; i < samples.length - 2; i++) {
    if (samples[i].d > threshold && samples[i + 1].d > threshold && samples[i + 2].d > threshold) {
      return Math.max(0, samples[i].t - step);
    }
  }
  return 0;
}
