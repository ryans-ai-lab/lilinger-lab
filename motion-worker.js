import {createVisionTasks} from './motion-tasks.js';

// This worker only loads our pinned local assets. Never allow telemetry/uploads.
const localFetch = self.fetch.bind(self);
let blockedRequests = 0;
self.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, self.location.href);
  const method = String(init?.method || input?.method || 'GET').toUpperCase();
  if (url.origin !== self.location.origin || !['GET', 'HEAD'].includes(method)) {
    blockedRequests++;
    return Promise.reject(new TypeError('Tracking worker permits only local asset reads'));
  }
  return localFetch(input, init);
};

let tasks, backend;
self.onmessage = async ({data}) => {
  const {id, type, bitmap, timestamp, mode} = data;
  try {
    if (type === 'init') {
      tasks?.close(); tasks = null;
      try { tasks = await createVisionTasks({worker: true, delegate: data.delegate === 'CPU' ? 'CPU' : 'GPU'}); backend = data.delegate === 'CPU' ? 'worker-cpu' : 'worker-gpu'; }
      catch { tasks = await createVisionTasks({worker: true, delegate: 'CPU'}); backend = 'worker-cpu'; }
      self.postMessage({id, result: {backend}});
    } else if (type === 'infer') {
      if (!tasks) throw new Error('Tracking worker is not ready');
      self.postMessage({id, result: {...tasks.infer(bitmap, timestamp, mode), backend, blockedRequests}});
    }
  } catch (error) {
    self.postMessage({id, error: error?.message || 'Tracking worker failed'});
  } finally { bitmap?.close(); }
};
