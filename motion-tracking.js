import {createVisionTasks, TRACKING_VERSION} from './motion-tasks.js';
export {TRACKING_VERSION};

const errorMessage = error => {
  if (error?.name === 'NotAllowedError') return '摄像头权限未开启。可在浏览器的网站设置中允许后重试。';
  if (error?.name === 'NotFoundError') return '没有找到可用摄像头。';
  if (error?.name === 'NotReadableError') return '摄像头暂时不可用，可能正被其他应用占用。';
  return error?.message || '追踪暂时无法启动，请重试。';
};

function createWorkerBackend() {
  let canvas, context;
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
    ready: delegate => request('init', {delegate}),
    async infer(video, timestamp, mode) {
      // Snapshot through a bounded canvas: some WebKit versions expose
      // createImageBitmap but cannot reliably transfer a live video source.
      canvas ||= document.createElement('canvas');
      context ||= canvas.getContext('2d', {alpha: false});
      if (!context) throw new Error('浏览器无法读取视频画面。');
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      context.drawImage(video, 0, 0, width, height);
      const bitmap = await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => { settled = true; reject(new Error('视频取帧超时')); }, 3000);
        Promise.resolve().then(() => createImageBitmap(canvas)).then(value => {
          clearTimeout(timer); if (settled || closed) { value.close(); if (!settled) reject(new Error('Tracking stopped')); }
          else { settled = true; resolve(value); }
        }, error => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
      });
      try { return await request('infer', {bitmap, timestamp, mode}, [bitmap]); }
      finally { bitmap.close(); }
    },
    close() { if (closed) return; closed = true; worker.terminate(); fail(new Error('Tracking stopped')); if (canvas) { canvas.width = 0; canvas.height = 0; } },
  };
}

// Instantiate freely; only start() requests a camera. Call start() from a user action.
export function createMotionTracker({video, onResults = () => {}, onState = () => {}, onError = () => {}, maxFps = 20, preferredDelegate = 'auto'} = {}) {
  if (!video) throw new TypeError('A preview video element is required');
  if (!['auto', 'CPU', 'GPU'].includes(preferredDelegate)) throw new TypeError('Delegate must be auto, CPU or GPU');
  const mobileApple = /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Keep the mobile GPU available for the character renderer. This is a
  // conservative backend choice, not a claim that Safari GPU is unsupported.
  const delegate = preferredDelegate === 'auto' ? (mobileApple ? 'CPU' : 'GPU') : preferredDelegate;
  let state = {phase: 'idle', mode: 'body', backend: null, detail: '摄像头尚未开启'};
  let active = null, generation = 0, modeRevision = 0, disposed = false, lastTimestamp = 0;
  const emit = changes => { state = {...state, ...changes}; onState({...state}); };
  const cleanup = run => {
    if (!run) return;
    cancelAnimationFrame(run.raf); clearTimeout(run.frameWatchdog);
    if (run.vfc != null) video.cancelVideoFrameCallback?.(run.vfc);
    run.backend?.close();
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
    const run = {generation: ++generation, stream: null, backend: null, raf: 0, vfc: null, lastTick: 0, busy: false, submitted: 0, processed: 0, fallbackUsed: false};
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
          try { run.backend = createWorkerBackend(); info = await run.backend.ready(delegate); }
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
        let usesVideoFrames = typeof video.requestVideoFrameCallback === 'function';
        run.liveStartedAt = performance.now();
        const schedule = () => {
          if (!current(run)) return;
          if (usesVideoFrames) {
            run.vfc = video.requestVideoFrameCallback((now, metadata) => {
              if (!usesVideoFrames) return;
              clearTimeout(run.frameWatchdog); tick(now, metadata);
            });
            // Some browser/video combinations expose rVFC but never deliver it.
            // Do not leave a permanently 'live' tracker with no sampling loop.
            run.frameWatchdog = setTimeout(() => {
              if (!current(run) || !usesVideoFrames) return;
              video.cancelVideoFrameCallback?.(run.vfc); run.vfc = null;
              usesVideoFrames = false;
              emit({detail: '视频帧回调未响应，已切换兼容采样'});
              run.raf = requestAnimationFrame(tick);
            }, 2500);
          } else run.raf = requestAnimationFrame(tick);
        };
        const tick = async now => {
          if (!current(run)) return;
          schedule();
          const interval = 1000 / Math.max(1, Math.min(info.backend === 'main-cpu' ? 10 : 24, maxFps));
          // A live MediaStream's currentTime is not a frame-delivery signal.
          // rVFC reports decoded frames; older browsers use a bounded RAF loop.
          if (video.readyState < 2 || !(video.videoWidth > 0 && video.videoHeight > 0)) {
            if (!run.noFrameNotice && now - run.liveStartedAt > 5000) {
              run.noFrameNotice = true;
              emit({detail: '摄像头尚未提供可读取画面，可关闭后重新开启'});
            }
            return;
          }
          if (run.busy || now - run.lastTick < interval) return;
          run.busy = true; run.lastTick = now; run.submitted++;
          const timestamp = lastTimestamp = Math.max(performance.now(), lastTimestamp + .01);
          const frameMode = state.mode, frameRevision = modeRevision;
          try {
            const result = await run.backend.infer(video, timestamp, frameMode);
            if (current(run) && frameRevision === modeRevision) {
              run.processed++;
              const receivedAt = performance.now();
              onResults({...result, receivedAt, backend: info.backend,
                pipeline: {submitted: run.submitted, processed: run.processed, scheduler: usesVideoFrames ? 'video-frame' : 'animation-frame', capture: info.backend === 'main-cpu' ? 'video' : 'canvas-bitmap', roundTripMs: receivedAt - timestamp}});
            }
          } catch (error) {
            if (current(run) && !run.fallbackUsed && info.backend.startsWith('worker-')) {
              // A worker can initialize successfully but fail on its first real
              // video frame. Retry with a fresh main-thread CPU detector once.
              run.fallbackUsed = true; run.backend.close(); run.backend = null;
              emit({phase: 'loading', backend: null, detail: '正在切换兼容追踪模式'});
              try {
                const tasks = await createVisionTasks({delegate: 'CPU'});
                if (!current(run)) { tasks.close(); return; }
                run.backend = {infer: (image, time, mode) => tasks.infer(image, time, mode), close: () => tasks.close()};
                info = {backend: 'main-cpu'};
                emit({phase: 'live', backend: info.backend, detail: '兼容模式已开启，等待识别'});
              } catch (fallbackError) {
                if (current(run)) { stop(); emit({phase: 'error', detail: errorMessage(fallbackError)}); onError(fallbackError); }
              }
            } else if (current(run)) { stop(); emit({phase: 'error', detail: errorMessage(error)}); onError(error); }
          } finally { run.busy = false; }
        };
        schedule(); return true;
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
