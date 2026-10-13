import {Vector3, Quaternion, Matrix4, Euler} from './vendor/build/three.core.js';

const IDENTITY = new Quaternion();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finitePoint = p => p && [p.x, p.y, p.z].every(Number.isFinite);
const observed = p => finitePoint(p) && (p.visibility ?? 1) >= .55 && (p.presence ?? 1) >= .5;
const toModel = p => new Vector3(p.x, -p.y, -p.z);
const LIMBS = [
  ['LeftUpperArm', 'LeftLowerArm', 11, 13], ['LeftLowerArm', 'LeftHand', 13, 15],
  ['RightUpperArm', 'RightLowerArm', 12, 14], ['RightLowerArm', 'RightHand', 14, 16],
  ['LeftUpperLeg', 'LeftLowerLeg', 23, 25], ['LeftLowerLeg', 'LeftFoot', 25, 27],
  ['RightUpperLeg', 'RightLowerLeg', 24, 26], ['RightLowerLeg', 'RightFoot', 26, 28],
  ['LeftFoot', 'LeftToes', 27, 31], ['RightFoot', 'RightToes', 28, 32],
];
const EXPRESSION_NAMES = [
  'eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'mouthSmileLeft', 'mouthSmileRight',
  'browInnerUp', 'browDownLeft', 'browDownRight', 'mouthFunnel', 'browOuterUpLeft', 'browOuterUpRight',
];

function bounded(q, limits) {
  const e = new Euler().setFromQuaternion(q, 'YXZ');
  e.set(clamp(e.x, -limits[0], limits[0]), clamp(e.y, -limits[1], limits[1]), clamp(e.z, -limits[2], limits[2]), 'YXZ');
  return new Quaternion().setFromEuler(e);
}

function torsoFrame(points, left, right, {allowUpperBody = false} = {}) {
  if (![left, right].every(i => observed(points[i]))) return null;
  const x = toModel(points[left]).sub(toModel(points[right]));
  const fullTorso = [11, 12, 23, 24].every(i => observed(points[i]));
  if (!fullTorso && !allowUpperBody) return null;
  // A phone often sees shoulders and arms while hips are outside the image.
  // Use the observed shoulder axis for yaw/roll, with gravity as the up axis.
  const y = fullTorso ? toModel(points[11]).add(toModel(points[12])).multiplyScalar(.5)
    .sub(toModel(points[23]).add(toModel(points[24])).multiplyScalar(.5)) : new Vector3(0, 1, 0);
  if (x.lengthSq() < 1e-6 || y.lengthSq() < 1e-6) return null;
  x.normalize(); y.addScaledVector(x, -y.dot(x)).normalize();
  const z = new Vector3().crossVectors(x, y).normalize();
  if (z.lengthSq() < .5) return null;
  y.crossVectors(z, x).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

export function createRigDriver(root, rigSpec = {}, {smoothing = .10, lossTimeoutMs = 650, expressionGain = 1.15} = {}) {
  if (!root?.traverse) throw new TypeError('A loaded glTF scene is required');
  const bones = new Map(), expressions = new Map();
  root.updateMatrixWorld(true);
  const rootBind = root.getWorldQuaternion(new Quaternion());
  const rootInverse = rootBind.clone().invert();
  root.traverse(node => {
    if (node.isBone) {
      bones.set(node.name, {
        node, rest: node.quaternion.clone(), target: node.quaternion.clone(),
        bindWorld: rootInverse.clone().multiply(node.getWorldQuaternion(new Quaternion())),
      });
    }
    if (node.morphTargetDictionary && node.morphTargetInfluences) {
      for (const [name, index] of Object.entries(node.morphTargetDictionary)) {
        if (!EXPRESSION_NAMES.includes(name)) continue;
        const list = expressions.get(name) || [];
        list.push({node, index}); expressions.set(name, list);
      }
    }
  });
  const restDirections = new Map();
  for (const [name, child] of LIMBS) {
    const a = bones.get(name)?.node, b = bones.get(child)?.node;
    if (a && b) restDirections.set(name, b.getWorldPosition(new Vector3()).sub(a.getWorldPosition(new Vector3())).applyQuaternion(rootInverse).normalize());
  }
  let status = {source: 'idle', faceDetected: false, poseDetected: false, drivenBones: 0, availableBones: bones.size, availableExpressions: [...expressions.keys()], calibrated: false};
  let previousFrame = null, lastArrival = -Infinity, faceNeutral = null, latestFace = null;
  const faceTargets = new Map(EXPRESSION_NAMES.map(name => [name, 0]));
  const targetsAtRest = () => { for (const bone of bones.values()) bone.target.copy(bone.rest); for (const name of faceTargets.keys()) faceTargets.set(name, 0); };
  const setWorldTarget = (name, modelQuat) => {
    const bone = bones.get(name); if (!bone) return false;
    const rootQ = root.getWorldQuaternion(new Quaternion());
    const desired = rootQ.multiply(modelQuat);
    const parentQ = bone.node.parent?.getWorldQuaternion(new Quaternion()) || IDENTITY;
    bone.target.copy(parentQ.invert().multiply(desired)).normalize();
    return true;
  };
  const smoothBone = (bone, alpha) => {
    if (![bone.target.x, bone.target.y, bone.target.z, bone.target.w].every(Number.isFinite)) bone.target.copy(bone.rest);
    bone.node.quaternion.slerp(bone.target, alpha).normalize();
    bone.node.updateMatrixWorld(true);
  };
  function update(frame, dt = 1 / 60) {
    const now = performance.now();
    if (frame && frame !== previousFrame) { previousFrame = frame; lastArrival = now; }
    const frameAge = Number.isFinite(frame?.timestamp) ? now - frame.timestamp : Infinity;
    // Capture timestamps precede inference. A freshly delivered, slower CPU
    // result must not be discarded simply because inference took >450 ms.
    const budget = Math.min(1500, Math.max(lossTimeoutMs, (frame?.inferenceMs || 0) * 2 + 150));
    const arrivalAge = now - (Number.isFinite(frame?.receivedAt) ? frame.receivedAt : lastArrival);
    const fresh = frame?.source === 'camera' && !frame.stopped && frameAge >= -100 && frameAge <= budget && arrivalAge >= -100 && arrivalAge <= budget && now - lastArrival <= budget;
    const face = fresh && frame.faceDetected !== false && frame.face?.faceLandmarks?.[0]?.length ? frame.face : null;
    const points = fresh && frame.poseDetected !== false ? frame.pose?.worldLandmarks?.[0] : null;
    const hasBody = !!points && LIMBS.some(([, , from, to]) => observed(points[from]) && observed(points[to]));
    const fullBody = !!points && [11, 12, 23, 24, 25, 26, 27, 28].every(i => observed(points[i]));
    const alpha = 1 - Math.exp(-clamp(Number.isFinite(dt) ? dt : 1 / 60, 0, .1) / Math.max(.01, smoothing));
    targetsAtRest();
    let driven = 0;
    const hipsQ = hasBody ? torsoFrame(points, 23, 24) : null;
    const chestQ = hasBody ? torsoFrame(points, 11, 12, {allowUpperBody: true}) : null;
    if (hipsQ && setWorldTarget('Hips', bounded(hipsQ, [.35, .85, .4]))) driven++;
    // Apply parents first; desired limb orientations are in model space.
    for (const name of ['Hips', 'Spine', 'Chest']) if (bones.has(name)) smoothBone(bones.get(name), alpha);
    if (chestQ && setWorldTarget('UpperChest', bounded(chestQ, [.45, 1.0, .5]))) driven++;
    if (bones.has('UpperChest')) smoothBone(bones.get('UpperChest'), alpha);
    for (const name of ['LeftShoulder', 'RightShoulder']) if (bones.has(name)) smoothBone(bones.get(name), alpha);
    for (const [name, , from, to] of LIMBS) {
      const bone = bones.get(name), restDir = restDirections.get(name);
      if (!bone) continue;
      if (points && restDir && observed(points[from]) && observed(points[to])) {
        const targetDir = toModel(points[to]).sub(toModel(points[from]));
        if (targetDir.lengthSq() > 1e-6) {
          const delta = new Quaternion().setFromUnitVectors(restDir, targetDir.normalize());
          if (setWorldTarget(name, delta.multiply(bone.bindWorld))) driven++;
        }
      }
      smoothBone(bone, alpha);
    }
    if (bones.has('Neck')) smoothBone(bones.get('Neck'), alpha);
    const faceMatrix = face?.facialTransformationMatrixes?.[0]?.data;
    latestFace = null;
    if (faceMatrix?.length === 16 && faceMatrix.every(Number.isFinite)) {
      const matrix = new Matrix4().fromArray(faceMatrix);
      const rotation = new Matrix4().extractRotation(matrix);
      latestFace = new Quaternion().setFromRotationMatrix(rotation).normalize();
      const relative = faceNeutral ? latestFace.clone().multiply(faceNeutral.clone().invert()) : latestFace.clone();
      if (setWorldTarget('Head', bounded(relative, [.5, 1.0, .5]))) driven++;
    }
    if (bones.has('Head')) smoothBone(bones.get('Head'), alpha);
    // Unmapped leaf joints remain at bind pose; no invented finger motion.
    const drivenNames = new Set(['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder', ...LIMBS.map(x => x[0])]);
    for (const [name, bone] of bones) if (!drivenNames.has(name)) smoothBone(bone, alpha);
    if (face) {
      for (const category of face.faceBlendshapes?.[0]?.categories || []) {
        if (faceTargets.has(category.categoryName) && Number.isFinite(category.score)) faceTargets.set(category.categoryName, clamp(category.score * expressionGain, 0, 1));
      }
    }
    for (const [name, entries] of expressions) for (const {node, index} of entries) {
      const before = Number.isFinite(node.morphTargetInfluences[index]) ? node.morphTargetInfluences[index] : 0;
      node.morphTargetInfluences[index] = before + ((faceTargets.get(name) || 0) - before) * alpha;
    }
    status = {...status, source: fresh ? 'camera' : 'idle', faceDetected: !!face, poseDetected: hasBody, fullBody, drivenBones: driven, frameAgeMs: Number.isFinite(frameAge) ? Math.round(frameAge) : null};
    return {...status};
  }
  function reset() {
    targetsAtRest();
    for (const bone of bones.values()) bone.node.quaternion.copy(bone.rest);
    for (const entries of expressions.values()) for (const {node, index} of entries) node.morphTargetInfluences[index] = 0;
    root.updateMatrixWorld(true); previousFrame = null; lastArrival = -Infinity; latestFace = null;
    status = {...status, source: 'idle', faceDetected: false, poseDetected: false, fullBody: false, drivenBones: 0};
  }
  return {
    update, reset,
    calibrate() { if (!latestFace) return false; faceNeutral = latestFace.clone(); status = {...status, calibrated: true}; return true; },
    demo(name = 'wave', t = 0) {
      reset();
      const time = Number.isFinite(t) ? t : 0;
      const rotate = (boneName, x, y, z) => { const b = bones.get(boneName); if (b) b.node.quaternion.copy(b.rest).multiply(new Quaternion().setFromEuler(new Euler(x, y, z))); };
      if (name === 'blink') {
        const blink = Math.pow(Math.max(0, Math.sin(time * 2.5)), 6);
        for (const key of ['eyeBlinkLeft', 'eyeBlinkRight']) for (const e of expressions.get(key) || []) e.node.morphTargetInfluences[e.index] = blink;
      } else if (name === 'jaw') {
        for (const e of expressions.get('jawOpen') || []) e.node.morphTargetInfluences[e.index] = .45 + .35 * Math.sin(time * 2);
      } else if (name === 'face' || name === 'smile') {
        rotate('Head', .12 * Math.sin(time), .3 * Math.sin(time * .7), .07 * Math.sin(time * 1.2));
        for (const key of ['mouthSmileLeft', 'mouthSmileRight']) for (const e of expressions.get(key) || []) e.node.morphTargetInfluences[e.index] = .55 + .25 * Math.sin(time);
        for (const e of expressions.get('jawOpen') || []) e.node.morphTargetInfluences[e.index] = .15 + .1 * Math.sin(time * 2);
      } else {
        rotate('RightUpperArm', 0, 0, -1.35); rotate('RightLowerArm', .1, .1, -1.05 + .25 * Math.sin(time * 3));
        rotate('Head', 0, -.12, .06 * Math.sin(time));
      }
      root.updateMatrixWorld(true); status = {...status, source: 'demo', faceDetected: false, poseDetected: false};
      return {...status};
    },
    get status() { return {...status}; },
  };
}
