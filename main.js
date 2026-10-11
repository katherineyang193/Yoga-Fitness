import {
  FilesetResolver,
  PoseLandmarker,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

const MODES = {
  office: {
    title: "久坐救援",
    exercises: [
      {
        id: "side-stretch",
        name: "站姿側伸展",
        subtitle: "肩頸・側腰",
        instruction: "雙腳站穩，單手上舉，身體慢慢往另一側伸展。",
        type: "hold",
        targetHold: 6
      },
      {
        id: "overhead-stretch",
        name: "雙手上舉伸展",
        subtitle: "肩背・胸口",
        instruction: "雙手舉過頭頂，手臂伸長，軀幹保持直立。",
        type: "hold",
        targetHold: 6
      }
    ]
  },
  yoga: {
    title: "站姿瑜珈",
    exercises: [
      {
        id: "tree",
        name: "樹式 Tree Pose",
        subtitle: "平衡・穩定",
        instruction: "單腳站立，另一腳抬起靠近支撐腿，軀幹保持直立。",
        type: "hold",
        targetHold: 8
      },
      {
        id: "warrior2",
        name: "戰士二式 Warrior II",
        subtitle: "腿部・肩膀",
        instruction: "雙手向左右伸平，前腿彎曲、後腿伸直，軀幹保持挺直。",
        type: "hold",
        targetHold: 8
      }
    ]
  },
  fitness: {
    title: "基礎健身",
    exercises: [
      {
        id: "squat",
        name: "深蹲 Squat",
        subtitle: "下肢・動作計數",
        instruction: "雙腳站穩後下蹲，再完整站起。完整下蹲再站回來才計 1 次。",
        type: "reps",
        targetHold: 0
      },
      {
        id: "lunge",
        name: "弓箭步 Lunge",
        subtitle: "下肢・穩定",
        instruction: "一腳向前，前後腿彎曲並保持軀幹直立。",
        type: "hold",
        targetHold: 6
      }
    ]
  }
};

const LANDMARKS = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28
};

const $ = (selector) => document.querySelector(selector);
const video = $("#webcam");
const canvas = $("#overlay");
const ctx = canvas.getContext("2d");
const cameraPanel = $("#cameraPanel");
const cameraWrap = $("#cameraWrap");
const cameraPlaceholder = $("#cameraPlaceholder");
const cameraState = $("#cameraState");
const mirrorBtn = $("#mirrorBtn");
const startCameraBtn = $("#startCameraBtn");
const resetBtn = $("#resetBtn");
const exitWorkoutBtn = $("#exitWorkoutBtn");
const modeTitle = $("#modeTitle");
const exerciseCount = $("#exerciseCount");
const exerciseList = $("#exerciseList");
const exerciseName = $("#exerciseName");
const exerciseInstruction = $("#exerciseInstruction");
const scoreValue = $("#scoreValue");
const scoreRing = $("#scoreRing");
const coachMessage = $("#coachMessage");
const detailMessage = $("#detailMessage");
const holdValue = $("#holdValue");
const repValue = $("#repValue");
const visibilityValue = $("#visibilityValue");
const holdBar = $("#holdBar");

const stageExerciseName = $("#stageExerciseName");
const stageInstruction = $("#stageInstruction");
const stageCoachMessage = $("#stageCoachMessage");
const stageDetailMessage = $("#stageDetailMessage");
const stageScoreValue = $("#stageScoreValue");
const stageHoldValue = $("#stageHoldValue");
const stageRepValue = $("#stageRepValue");
const stageHoldBar = $("#stageHoldBar");

let currentMode = "office";
let currentExercise = MODES.office.exercises[0];
let poseLandmarker = null;
let drawingUtils = null;
let stream = null;
let running = false;
let mirrored = true;
let lastVideoTime = -1;
let lastFrameTimestamp = performance.now();
let holdSeconds = 0;
let reps = 0;
let squatState = "up";
let trackingAcquired = false;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function angle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.hypot(ab.x, ab.y);
  const magCB = Math.hypot(cb.x, cb.y);
  if (!magAB || !magCB) return 0;
  return Math.acos(clamp(dot / (magAB * magCB), -1, 1)) * 180 / Math.PI;
}

function joint(landmarks, index) {
  return landmarks[index];
}

function visibilityScore(landmarks) {
  const required = [
    0,
    LANDMARKS.LEFT_SHOULDER,
    LANDMARKS.RIGHT_SHOULDER,
    LANDMARKS.LEFT_HIP,
    LANDMARKS.RIGHT_HIP,
    LANDMARKS.LEFT_KNEE,
    LANDMARKS.RIGHT_KNEE,
    LANDMARKS.LEFT_ANKLE,
    LANDMARKS.RIGHT_ANKLE
  ];
  const values = required.map((index) => landmarks[index]?.visibility ?? 0);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function scoreNear(value, target, tolerance) {
  return clamp(1 - Math.abs(value - target) / tolerance, 0, 1);
}

function evaluateExercise(landmarks, deltaSeconds) {
  const ls = joint(landmarks, LANDMARKS.LEFT_SHOULDER);
  const rs = joint(landmarks, LANDMARKS.RIGHT_SHOULDER);
  const le = joint(landmarks, LANDMARKS.LEFT_ELBOW);
  const re = joint(landmarks, LANDMARKS.RIGHT_ELBOW);
  const lw = joint(landmarks, LANDMARKS.LEFT_WRIST);
  const rw = joint(landmarks, LANDMARKS.RIGHT_WRIST);
  const lh = joint(landmarks, LANDMARKS.LEFT_HIP);
  const rh = joint(landmarks, LANDMARKS.RIGHT_HIP);
  const lk = joint(landmarks, LANDMARKS.LEFT_KNEE);
  const rk = joint(landmarks, LANDMARKS.RIGHT_KNEE);
  const la = joint(landmarks, LANDMARKS.LEFT_ANKLE);
  const ra = joint(landmarks, LANDMARKS.RIGHT_ANKLE);

  const leftElbow = angle(ls, le, lw);
  const rightElbow = angle(rs, re, rw);
  const leftKnee = angle(lh, lk, la);
  const rightKnee = angle(rh, rk, ra);
  const shoulderLevel = Math.abs(ls.y - rs.y);
  const hipLevel = Math.abs(lh.y - rh.y);

  let score = 0;
  let message = "保持姿勢";
  let detail = "正在比對關節角度。";

  switch (currentExercise.id) {
    case "overhead-stretch": {
      const wristsHigh = ((ls.y - lw.y) + (rs.y - rw.y)) / 2;
      const armsStraight = (scoreNear(leftElbow, 175, 30) + scoreNear(rightElbow, 175, 30)) / 2;
      score = 100 * clamp((wristsHigh * 3.2 + armsStraight) / 2, 0, 1);
      message = wristsHigh > 0.12 ? "很好！手臂繼續往上延伸" : "雙手再舉高一點";
      detail = "保持肩膀放鬆，不需要聳肩。";
      break;
    }
    case "side-stretch": {
      const oneWristHigh = Math.max(ls.y - lw.y, rs.y - rw.y);
      const sideShift = Math.abs((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2);
      score = 100 * clamp((oneWristHigh * 3 + sideShift * 5) / 2, 0, 1);
      message = sideShift > 0.04 ? "有伸展到！維持住" : "身體再往側邊延伸一些";
      detail = "不要急著壓低，慢慢延伸側腰即可。";
      break;
    }
    case "tree": {
      const leftLift = Math.abs(la.y - rk.y);
      const rightLift = Math.abs(ra.y - lk.y);
      const lifted = Math.min(leftLift, rightLift);
      const torsoStable = 1 - clamp((shoulderLevel + hipLevel) * 4, 0, 1);
      score = 100 * clamp((torsoStable + (1 - clamp(lifted * 3, 0, 1))) / 2, 0, 1);
      message = torsoStable > 0.72 ? "身體很穩！繼續維持" : "軀幹再直一些，先求穩";
      detail = "單腳抬起後，視線看前方固定點會比較穩。";
      break;
    }
    case "warrior2": {
      const armsLevel = 1 - clamp((Math.abs(lw.y - ls.y) + Math.abs(rw.y - rs.y)) * 3.5, 0, 1);
      const frontKnee = Math.min(leftKnee, rightKnee);
      const backKnee = Math.max(leftKnee, rightKnee);
      const kneeScore = (scoreNear(frontKnee, 105, 45) + scoreNear(backKnee, 170, 30)) / 2;
      score = 100 * clamp((armsLevel + kneeScore) / 2, 0, 1);
      message = armsLevel > 0.72 ? "手臂高度很好！" : "雙手抬到接近肩膀高度";
      detail = frontKnee > 135 ? "前腿再彎一些。" : "前後腿狀態不錯，維持住。";
      break;
    }
    case "lunge": {
      const frontKnee = Math.min(leftKnee, rightKnee);
      const backKnee = Math.max(leftKnee, rightKnee);
      const kneeScore = (scoreNear(frontKnee, 100, 45) + scoreNear(backKnee, 145, 55)) / 2;
      const torsoScore = 1 - clamp((shoulderLevel + hipLevel) * 3, 0, 1);
      score = 100 * clamp((kneeScore + torsoScore) / 2, 0, 1);
      message = frontKnee < 140 ? "很好！保持軀幹直立" : "前腿再彎一點";
      detail = "先以穩定為主，不追求過大的跨步。";
      break;
    }
    case "squat": {
      const avgKnee = (leftKnee + rightKnee) / 2;
      if (avgKnee < 112 && squatState === "up") squatState = "down";
      if (avgKnee > 158 && squatState === "down") {
        squatState = "up";
        reps += 1;
      }
      score = 100 * clamp((170 - avgKnee) / 70, 0, 1);
      if (squatState === "down") {
        message = "蹲到了！慢慢站回來";
        detail = `目前膝關節平均約 ${Math.round(avgKnee)}°。`;
      } else {
        message = avgKnee < 145 ? "再蹲低一些" : "準備下一次深蹲";
        detail = "完整下蹲再站起才會計 1 次。";
      }
      break;
    }
  }

  const isGoodPose = score >= 72;
  if (currentExercise.type === "hold") {
    holdSeconds = isGoodPose ? holdSeconds + deltaSeconds : Math.max(0, holdSeconds - deltaSeconds * 0.7);
  } else {
    holdSeconds = 0;
  }

  return { score: Math.round(clamp(score, 0, 100)), message, detail };
}

function setScore(score) {
  scoreValue.textContent = score;
  stageScoreValue.textContent = score;
  scoreRing.style.background = `conic-gradient(#7aa889 ${score * 3.6}deg, #e2e8e3 0deg)`;
}

function setCoachText(main, detail) {
  coachMessage.textContent = main;
  detailMessage.textContent = detail;
  stageCoachMessage.textContent = main;
  stageDetailMessage.textContent = detail;
}

function syncMetrics() {
  holdValue.textContent = `${holdSeconds.toFixed(1)}s`;
  stageHoldValue.textContent = `${holdSeconds.toFixed(1)}s`;
  repValue.textContent = reps;
  stageRepValue.textContent = reps;
  const target = currentExercise.targetHold || 1;
  const progress = currentExercise.type === "hold" ? clamp(holdSeconds / target, 0, 1) * 100 : 0;
  holdBar.style.width = `${progress}%`;
  stageHoldBar.style.width = `${progress}%`;
}

function setTrackingState(state) {
  cameraWrap.classList.toggle("tracking-ok", state === "ok");
  cameraWrap.classList.toggle("tracking-poor", state === "poor");
}

function renderExerciseList() {
  const mode = MODES[currentMode];
  modeTitle.textContent = mode.title;
  exerciseCount.textContent = mode.exercises.length;
  exerciseList.innerHTML = "";
  mode.exercises.forEach((exercise) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `exercise-btn${exercise.id === currentExercise.id ? " active" : ""}`;
    btn.innerHTML = `<strong>${exercise.name}</strong><small>${exercise.subtitle}</small>`;
    btn.addEventListener("click", () => selectExercise(exercise));
    exerciseList.appendChild(btn);
  });
}

function selectExercise(exercise) {
  currentExercise = exercise;
  exerciseName.textContent = exercise.name;
  exerciseInstruction.textContent = exercise.instruction;
  stageExerciseName.textContent = exercise.name;
  stageInstruction.textContent = exercise.instruction;
  holdSeconds = 0;
  reps = 0;
  squatState = "up";
  syncMetrics();
  setCoachText(running ? "準備好後開始動作" : "按下「開始運動」", running ? "保持全身在畫面內。" : "開始後所有動作提示都會放大在主畫面上。");
  setScore(0);
  renderExerciseList();
}

async function createPoseLandmarker() {
  if (poseLandmarker) return poseLandmarker;
  cameraState.textContent = "載入姿勢模型…";
  stageCoachMessage.textContent = "正在載入動作辨識…";
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  drawingUtils = new DrawingUtils(ctx);
  return poseLandmarker;
}

function enterWorkoutUI() {
  document.body.classList.add("workout-active");
  exitWorkoutBtn.hidden = false;
  stageExerciseName.textContent = currentExercise.name;
  stageInstruction.textContent = currentExercise.instruction;
}

async function requestWorkoutFullscreen() {
  enterWorkoutUI();
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    try { await document.documentElement.requestFullscreen(); } catch (_) { /* browser may reject; CSS fullscreen remains */ }
  }
}

async function startCamera() {
  requestWorkoutFullscreen();
  setTrackingState("none");
  trackingAcquired = false;
  setCoachText("正在開啟鏡頭…", "請站到鏡頭前，讓頭、肩、髖、膝、腳踝都進入畫面。");
  try {
    await createPoseLandmarker();
    stream?.getTracks().forEach((track) => track.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    running = true;
    cameraPlaceholder.classList.add("hidden");
    cameraState.textContent = "尋找全身…";
    startCameraBtn.textContent = "重新啟動鏡頭";
    syncMirror();
    lastFrameTimestamp = performance.now();
    requestAnimationFrame(predictLoop);
  } catch (error) {
    console.error(error);
    cameraState.textContent = "無法啟動鏡頭";
    setCoachText("鏡頭或姿勢模型啟動失敗", "請確認已允許攝影機權限，並使用 HTTPS 開啟。");
  }
}

function syncCanvasSize() {
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function drawResult(result) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!result.landmarks?.length) return;
  const landmarks = result.landmarks[0];
  drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
    color: "#8cffaa",
    lineWidth: 5
  });
  drawingUtils.drawLandmarks(landmarks, {
    color: "#ffffff",
    fillColor: "#1f7a45",
    radius: 4
  });
}

function updateCoach(landmarks, deltaSeconds) {
  const visible = visibilityScore(landmarks);
  const visiblePercent = Math.round(visible * 100);
  visibilityValue.textContent = `${visiblePercent}%`;

  if (visible < 0.6) {
    trackingAcquired = false;
    setTrackingState("poor");
    cameraState.textContent = `人體辨識 ${visiblePercent}%`;
    setScore(0);
    setCoachText("請讓全身完整進入畫面", "往後退一點，讓頭、肩、髖、膝和腳踝都看得到。");
    holdSeconds = 0;
    syncMetrics();
    return;
  }

  setTrackingState("ok");
  cameraState.textContent = "✓ 全身辨識成功";
  if (!trackingAcquired) {
    trackingAcquired = true;
    setCoachText("找到你了！開始動作", currentExercise.instruction);
  }

  const evaluation = evaluateExercise(landmarks, deltaSeconds);
  setScore(evaluation.score);
  setCoachText(evaluation.message, evaluation.detail);
  syncMetrics();

  if (currentExercise.type === "hold" && holdSeconds >= currentExercise.targetHold) {
    setCoachText("✨ 完成！姿勢維持成功", "做得很好，可以放鬆回到自然站姿。");
  }
}

function predictLoop() {
  if (!running || !poseLandmarker || video.readyState < 2) return;
  syncCanvasSize();
  const now = performance.now();
  const deltaSeconds = Math.min((now - lastFrameTimestamp) / 1000, 0.1);
  lastFrameTimestamp = now;

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = poseLandmarker.detectForVideo(video, now);
    drawResult(result);
    if (result.landmarks?.length) {
      updateCoach(result.landmarks[0], deltaSeconds);
    } else {
      trackingAcquired = false;
      setTrackingState("none");
      visibilityValue.textContent = "--";
      cameraState.textContent = "尋找人體…";
      setCoachText("站到鏡頭中央", "目前還沒找到完整人體，請確認光線與距離。");
    }
  }
  requestAnimationFrame(predictLoop);
}

function syncMirror() {
  video.classList.toggle("mirrored", mirrored);
  canvas.classList.toggle("mirrored", mirrored);
  mirrorBtn.textContent = `鏡像：${mirrored ? "開" : "關"}`;
}

async function exitWorkout() {
  document.body.classList.remove("workout-active");
  exitWorkoutBtn.hidden = true;
  if (document.fullscreenElement && document.exitFullscreen) {
    try { await document.exitFullscreen(); } catch (_) {}
  }
}

function resetSession() {
  holdSeconds = 0;
  reps = 0;
  squatState = "up";
  trackingAcquired = false;
  setTrackingState("none");
  syncMetrics();
  setScore(0);
  setCoachText("已重新校正", "回到畫面中央，讓全身完整進入鏡頭。");
}

document.querySelectorAll(".mode-card").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".mode-card").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    currentMode = button.dataset.mode;
    selectExercise(MODES[currentMode].exercises[0]);
  });
});

mirrorBtn.addEventListener("click", () => {
  mirrored = !mirrored;
  syncMirror();
});

startCameraBtn.addEventListener("click", startCamera);
resetBtn.addEventListener("click", resetSession);
exitWorkoutBtn.addEventListener("click", exitWorkout);

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && document.body.classList.contains("workout-active") && !running) {
    document.body.classList.remove("workout-active");
  }
});

syncMirror();
renderExerciseList();
selectExercise(currentExercise);
