// Pinned, same-origin MediaPipe assets. This module never sends camera frames.
export const TRACKING_VERSION = '1.1.0';
export const TRACKING_ASSETS = Object.freeze({
  bundle: new URL('./vendor/mediapipe/1.1.0/vision_bundle.mjs', import.meta.url).href,
  wasm: new URL('./vendor/mediapipe/1.1.0/wasm', import.meta.url).href,
  face: new URL('./models/tracking/face_landmarker.task', import.meta.url).href,
  pose: new URL('./models/tracking/pose_landmarker_lite.task', import.meta.url).href,
});

export async function createVisionTasks({worker = false, delegate = 'GPU'} = {}) {
  const {FilesetResolver, FaceLandmarker, PoseLandmarker} = await import(TRACKING_ASSETS.bundle);
  // Module WASM avoids importScripts in module workers (MediaPipe 1.1.0).
  const fileset = await FilesetResolver.forVisionTasks(TRACKING_ASSETS.wasm, worker);
  // 1.1.0 clears the global factory after each task. ES module imports are cached,
  // so the second task must reinstall its exported factory explicitly.
  const factory = worker ? (await import(fileset.wasmLoaderPath)).default : null;
  const taskFileset = worker ? {...fileset, wasmLoaderPath: ''} : fileset;
  const prepareFactory = () => { if (factory) globalThis.ModuleFactory = factory; };
  const makeCanvas = () => worker ? new OffscreenCanvas(640, 480) : document.createElement('canvas');
  let face, pose;
  try {
    prepareFactory();
    face = await FaceLandmarker.createFromOptions(taskFileset, {
      baseOptions: {modelAssetPath: TRACKING_ASSETS.face, delegate},
      canvas: makeCanvas(), runningMode: 'VIDEO', numFaces: 1,
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: .55, minFacePresenceConfidence: .55, minTrackingConfidence: .55,
    });
    prepareFactory();
    pose = await PoseLandmarker.createFromOptions(taskFileset, {
      baseOptions: {modelAssetPath: TRACKING_ASSETS.pose, delegate},
      canvas: makeCanvas(), runningMode: 'VIDEO', numPoses: 1,
      outputSegmentationMasks: false,
      minPoseDetectionConfidence: .55, minPosePresenceConfidence: .55, minTrackingConfidence: .55,
    });
  } catch (error) { face?.close(); pose?.close(); throw error; }
  return {
    infer(image, timestamp, mode = 'body') {
      const start = performance.now();
      const faceResult = face.detectForVideo(image, timestamp);
      const poseResult = mode === 'body' ? pose.detectForVideo(image, timestamp) : null;
      return {
        source: 'camera', timestamp, face: faceResult, pose: poseResult,
        faceDetected: !!faceResult.faceLandmarks?.length,
        poseDetected: !!poseResult?.worldLandmarks?.length,
        inferenceMs: performance.now() - start,
      };
    },
    close() { face.close(); pose.close(); },
  };
}
