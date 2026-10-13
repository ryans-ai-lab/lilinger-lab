import {createVisionTasks, TRACKING_VERSION} from './motion-tasks.js';
export {TRACKING_VERSION};

const errorMessage = error => {
  if (error?.name === 'NotAllowedError') return '摄像头权限未开启。可在浏览器的网站设置中允许后重试。';
  if (error?.name === 'NotFoundError') return '没有找到可用摄像头。';
  if (error?.name === 'NotReadableError') return '摄像头暂时不可用，可能正被其他应用占用。';
  return error?.message || '追踪暂时无法启动，请重试。';
};

function createWorkerBackend() {
  const worker = new Worker(new URL('./motion-worker.js', import.meta.url), {type: 'module'});
  const pending = new Map(); let nextId = 0, closed = false;
  const fail = error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
  worker.onmessage = ({data}) => {
    const p = pending.get(data.id); if (!p) return;
    clearTimeout(p.timer); pending.delete(data.id);
    if (data.error) p.reject(new Error(data.error)); else p.resolve(data.result);
  };
  worker.onerror = () => fail(new Error('当前浏览器无法启动追踪工作线程。'));
  const request = (type, data = {}, transfer = []) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error('Tracking stopped'));
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('追踪模型加载或推理超时，请重试。')); }, type === 'init' ? 90000 : 10000);
    pending.set(id, {resolve, reject, timer});
    try { worker.postMessage({id, type, ...data}, transfer); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
  return {
    ready: () => request('init'),
    async infer(video, timestamp, mode) {
      const bitmap = await createImageBitmap(video);
      try { return await request('infer', {bitmap, timestamp, mode}, [bitmap]); }
      finally { bitmap.close(); }
    },
    close() { if (closed) return; closed = true; worker.terminate(); fail(new Error('Tracking stopped')); },
  };
}

// Instantiate freely; only start() requests a camera. Call start() from a user action.
export function createMotionTracker({video, onResults = () => {}, onState = () => {}, onError = () => {}, maxFps = 20} = {}) {
  if (!video) throw new TypeError('A preview video element is required');
  let state = {phase: 'idle', mode: 'body', backend: null, detail: '摄像头尚未开启'};
  let active = null, generation = 0, modeRevision = 0, disposed = false, lastTimestamp = 0;
  const emit = changes => { state = {...state, ...changes}; onState({...state}); };
  const cleanup = run => {
    if (!run) return;
    cancelAnimationFrame(run.raf); run.backend?.close();
    run.stream?.getTracks().forEach(track => track.stop());
    if (video.srcObject === run.stream) { video.pause(); video.srcObject = null; }
  };
  const stop = (reason = '摄像头已关闭') => {
    ++generation; const run = active; active = null; cleanup(run);
    emit({phase: 'stopped', backend: null, detail: reason});
    onResults({source: 'camera', timestamp: performance.now(), face: null, pose: null, faceDetected: false, poseDetected: false, stopped: true});
  };
  const captureAllowed = () => video.isConnected !== false && !document.getElementById?.('ryanlab-temporary-access');
  const current = run => {
    if (active !== run || generation !== run.generation || disposed) return false;
    if (!captureAllowed()) { stop('访问或预览已关闭，摄像头已停止'); return false; }
    return true;
  };
  async function start() {
    if (disposed) return false;
    if (active) return active.promise;
    if (!captureAllowed()) { emit({phase: 'stopped', detail: '访问或预览已关闭，摄像头未开启'}); return false; }
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      const error = new Error('摄像头需要 HTTPS 或本机 localhost，并使用支持摄像头的浏览器。');
      emit({phase: 'error', detail: error.message}); onError(error); return false;
    }
    const run = {generation: ++generation, stream: null, backend: null, raf: 0, lastFrame: -1, lastTick: 0, busy: false};
    active = run;
    emit({phase: 'requesting', backend: null, detail: '等待摄像头授权'});
    video.muted = true; video.playsInline = true; video.setAttribute('playsinline', '');
    // Request immediately in the click handler; no microphone or recording API.
    let streamPromise;
    try { streamPromise = navigator.mediaDevices.getUserMedia({audio: false, video: {facingMode: 'user', width: {ideal: 640}, height: {ideal: 480}, frameRate: {ideal: 24, max: 30}}}); }
    catch (error) { active = null; emit({phase: 'error', detail: errorMessage(error)}); onError(error); return false; }
    run.promise = (async () => {
      try {
        run.stream = await streamPromise;
        if (!current(run)) { cleanup(run); return false; }
        video.srcObject = run.stream; await video.play();
        if (!current(run)) { cleanup(run); return false; }
        for (const track of run.stream.getVideoTracks()) track.addEventListener('ended', () => { if (current(run)) stop('摄像头连接已结束，请重新开启'); }, {once: true});
        emit({phase: 'loading', detail: '正在载入本机追踪模型'});
        let info;
        if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
          try { run.backend = createWorkerBackend(); info = await run.backend.ready(); }
          catch (error) { run.backend?.close(); run.backend = null; if (!current(run)) return false; }
        }
        if (!run.backend) {
          if (!current(run)) return false;
          const tasks = await createVisionTasks({delegate: 'CPU'});
          run.backend = {infer: (image, timestamp, mode) => tasks.infer(image, timestamp, mode), close: () => tasks.close()};
          info = {backend: 'main-cpu'};
        }
        if (!current(run)) { cleanup(run); return false; }
        emit({phase: 'live', backend: info.backend, detail: '摄像头已开启，等待识别'});
        const interval = 1000 / Math.max(1, Math.min(info.backend === 'main-cpu' ? 10 : 24, maxFps));
        const tick = async now => {
          if (!current(run)) return;
          run.raf = requestAnimationFrame(tick);
          if (run.busy || video.readyState < 2 || video.currentTime === run.lastFrame || now - run.lastTick < interval) return;
          run.busy = true; run.lastFrame = video.currentTime; run.lastTick = now;
          const timestamp = lastTimestamp = Math.max(performance.now(), lastTimestamp + .01);
          const frameMode = state.mode, frameRevision = modeRevision;
          try {
            const result = await run.backend.infer(video, timestamp, frameMode);
            if (current(run) && frameRevision === modeRevision) onResults({...result, backend: info.backend});
          } catch (error) {
            if (current(run)) { stop(); emit({phase: 'error', detail: errorMessage(error)}); onError(error); }
          } finally { run.busy = false; }
        };
        run.raf = requestAnimationFrame(tick); return true;
      } catch (error) {
        if (current(run)) { active = null; cleanup(run); emit({phase: 'error', backend: null, detail: errorMessage(error)}); onError(error); }
        else cleanup(run);
        return false;
      }
    })();
    return run.promise;
  }
  const hide = () => { if (document.hidden && active) stop('页面已离开，摄像头已关闭'); };
  const leave = () => { if (active) stop('页面已离开，摄像头已关闭'); };
  const pause = () => {
    // A queued pause from an older stream must not stop a newly requested stream.
    if (active?.stream && video.paused && video.srcObject === active.stream && ['loading', 'live'].includes(state.phase)) stop('视频已暂停，摄像头已关闭');
  };
  const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => { if (active && !captureAllowed()) stop('访问或预览已关闭，摄像头已停止'); }) : null;
  if (document.documentElement) observer?.observe(document.documentElement, {childList: true, subtree: true});
  video.addEventListener?.('pause', pause);
  document.addEventListener('visibilitychange', hide); globalThis.addEventListener('pagehide', leave);
  return {
    start, stop,
    setMode(mode) { if (!['face', 'body'].includes(mode)) throw new TypeError('Mode must be face or body'); if (mode !== state.mode) modeRevision++; emit({mode}); },
    dispose() { if (disposed) return; stop(); disposed = true; observer?.disconnect(); video.removeEventListener?.('pause', pause); document.removeEventListener('visibilitychange', hide); globalThis.removeEventListener('pagehide', leave); },
    get state() { return {...state}; },
  };
}
