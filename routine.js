const $ = (s) => document.querySelector(s);

const ROUTINES = {
  office: {
    name: "久坐舒展綜合 3 回合",
    icon: "🪑",
    sequence: ["側腰伸展", "雙手上舉伸展", "坐姿扭轉"],
    rounds: [
      {
        title: "第一回合｜喚醒與舒展",
        subtitle: "動作放慢，找回呼吸",
        breaths: 3,
        cues: {
          "側腰伸展": "雙手叉腰，右手舉高向左側彎，感受右側腰與肋骨拉伸；回正後換邊。每邊 3 個深呼吸。",
          "雙手上舉伸展": "吸氣，雙手從身體兩側畫大圓向上；手指交叉、掌心向上翻。吐氣時拉長脊椎，停留 3 個深呼吸。",
          "坐姿扭轉": "吸氣讓脊椎長高，吐氣向右後方扭轉；回正後換左側。每邊 3 個深呼吸。"
        }
      },
      {
        title: "第二回合｜加深與流動",
        subtitle: "加強拉伸幅度，但不要硬撐",
        breaths: 4,
        cues: {
          "側腰伸展": "側彎幅度可以比第一回合再深一點，下方的手往椅側或地面延伸。每邊 4 個深呼吸。",
          "雙手上舉伸展": "雙手再次高舉，手臂稍微帶到耳朵後方，打開胸口與肩膀。停留 4 個深呼吸。",
          "坐姿扭轉": "扭轉時視線往後方肩膀看，吐氣時腹部微微內收。每邊 4 個深呼吸。"
        }
      },
      {
        title: "第三回合｜放鬆與靜心",
        subtitle: "回歸平穩，動作柔和",
        breaths: 2,
        cues: {
          "側腰伸展": "輕柔左右側彎，不追求幅度，只感受肌肉慢慢拉開。每邊 2 個深呼吸。",
          "雙手上舉伸展": "最後一次雙手高舉，深吸氣；吐氣時讓雙手像羽毛一樣從兩側慢慢落下。",
          "坐姿扭轉": "溫和地左右扭轉，放鬆脊椎最後的壓力。每邊 2 個深呼吸。"
        }
      }
    ]
  },
  yoga: {
    name: "站姿瑜珈連續 3 回合",
    icon: "🧘",
    sequence: ["樹式 Tree Pose", "戰士二式 Warrior II"],
    rounds: [
      { title: "第一回合｜找到穩定", subtitle: "動作放慢，先求穩定", breaths: 3 },
      { title: "第二回合｜延長與加深", subtitle: "姿勢更完整，維持更穩", breaths: 4 },
      { title: "第三回合｜流暢收尾", subtitle: "放慢呼吸，穩穩完成", breaths: 2 }
    ]
  },
  fitness: {
    name: "基礎健身連續 3 回合",
    icon: "🏋️",
    sequence: ["深蹲 Squat", "弓箭步 Lunge"],
    rounds: [
      { title: "第一回合｜暖身啟動", subtitle: "先把動作做完整", breaths: 0 },
      { title: "第二回合｜穩定節奏", subtitle: "維持動作品質與節奏", breaths: 0 },
      { title: "第三回合｜漂亮收尾", subtitle: "最後一輪，完整做完再休息", breaths: 0 }
    ]
  }
};

let routineActive = false;
let routineMode = "office";
let roundIndex = 0;
let exerciseIndex = 0;
let advancing = false;
let lastRep = 0;
let observer = null;

function injectRoutineUI() {
  if ($("#routineLauncher")) return;

  const style = document.createElement("style");
  style.textContent = `
    .routine-launcher{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:0 0 16px}
    .routine-btn{border:2px solid rgba(40,75,61,.12);background:linear-gradient(145deg,#fff,#f4f8f4);border-radius:20px;padding:14px 16px;text-align:left;cursor:pointer;color:#26342e;box-shadow:0 8px 24px rgba(40,75,61,.08)}
    .routine-btn:hover{transform:translateY(-2px)}.routine-btn strong{display:block;font-size:17px}.routine-btn small{display:block;margin-top:4px;opacity:.7}.routine-btn .ri{font-size:27px;margin-right:7px}
    .routine-hud{position:absolute;left:18px;top:86px;z-index:40;width:min(410px,calc(100vw - 440px));padding:14px 16px;border-radius:20px;background:rgba(7,18,12,.82);border:2px solid rgba(255,224,91,.9);box-shadow:0 8px 28px rgba(0,0,0,.28);backdrop-filter:blur(10px);color:#fff;pointer-events:none}
    .routine-hud[hidden]{display:none}.routine-progress{font-size:13px;font-weight:900;color:#ffe15d;letter-spacing:.05em}.routine-title{margin-top:3px;font-size:clamp(18px,2vw,28px);font-weight:1000}.routine-sub{margin-top:3px;font-size:14px;opacity:.82}.routine-current{margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.16);font-size:15px;font-weight:900}.routine-cue{margin-top:5px;font-size:14px;line-height:1.45;color:#f3f6f3}.routine-next{margin-top:7px;font-size:12px;opacity:.72}.routine-stop{position:absolute;right:12px;top:10px;pointer-events:auto;border:0;border-radius:999px;background:rgba(255,255,255,.14);color:#fff;padding:6px 10px;font-weight:900;cursor:pointer}
    body.workout-active .routine-launcher{display:none!important}
    @media(max-width:900px){.routine-launcher{grid-template-columns:1fr}.routine-hud{left:10px;top:112px;width:calc(100vw - 190px);padding:10px 12px}.routine-cue{font-size:12px}.routine-title{font-size:18px}}
  `;
  document.head.appendChild(style);

  const launcher = document.createElement("section");
  launcher.id = "routineLauncher";
  launcher.className = "routine-launcher";
  launcher.innerHTML = Object.entries(ROUTINES).map(([key,r]) => `
    <button class="routine-btn" data-routine="${key}" type="button">
      <strong><span class="ri">${r.icon}</span>${r.name}</strong>
      <small>自動串接動作與回合，不用每次重新選動作</small>
    </button>`).join("");
  const workspace = $(".workspace");
  workspace?.parentNode?.insertBefore(launcher, workspace);

  const hud = document.createElement("aside");
  hud.id = "routineHud";
  hud.className = "routine-hud";
  hud.hidden = true;
  hud.innerHTML = `
    <button id="routineStop" class="routine-stop" type="button">結束課程</button>
    <div id="routineProgress" class="routine-progress"></div>
    <div id="routineTitle" class="routine-title"></div>
    <div id="routineSub" class="routine-sub"></div>
    <div id="routineCurrent" class="routine-current"></div>
    <div id="routineCue" class="routine-cue"></div>
    <div id="routineNext" class="routine-next"></div>`;
  $("#cameraWrap")?.appendChild(hud);

  launcher.querySelectorAll("[data-routine]").forEach(btn => btn.addEventListener("click", () => startRoutine(btn.dataset.routine)));
  $("#routineStop")?.addEventListener("click", stopRoutine);
}

function routineSpeak(text, key) {
  const toggle = $("#ttsToggleBtn");
  if (!text || !toggle || toggle.textContent.includes("靜音") || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-TW";
  u.rate = 0.94;
  const vol = Number($("#ttsVolume")?.value ?? 0.8);
  u.volume = Number.isFinite(vol) ? vol : 0.8;
  u.datasetKey = key;
  speechSynthesis.speak(u);
}

function clickMode(mode) {
  const btn = document.querySelector(`.mode-card[data-mode="${mode}"]`);
  btn?.click();
}

function findExerciseButton(name) {
  return [...document.querySelectorAll(".exercise-btn")].find(b => b.querySelector("strong")?.textContent.trim() === name);
}

function currentRound() { return ROUTINES[routineMode].rounds[roundIndex]; }
function currentExerciseName() { return ROUTINES[routineMode].sequence[exerciseIndex]; }

function currentCue() {
  const round = currentRound();
  const name = currentExerciseName();
  if (round.cues?.[name]) return round.cues[name];
  if (routineMode === "yoga") return roundIndex === 0 ? "先找到穩定，再開始維持。" : roundIndex === 1 ? "動作幅度可以更完整，但不要犧牲平衡。" : "最後一輪放慢呼吸，穩穩完成。";
  return roundIndex === 0 ? "先把動作做完整，不追求速度。" : roundIndex === 1 ? "保持穩定節奏，每一次都完整回正。" : "最後一輪，動作漂亮做完再休息。";
}

function updateRoutineHud() {
  const r = ROUTINES[routineMode];
  const round = currentRound();
  const current = currentExerciseName();
  const next = exerciseIndex < r.sequence.length - 1 ? r.sequence[exerciseIndex + 1] : (roundIndex < r.rounds.length - 1 ? `下一回合：${r.sequence[0]}` : "完成整套課程");
  $("#routineProgress").textContent = `第 ${roundIndex + 1} / ${r.rounds.length} 回合 · 動作 ${exerciseIndex + 1} / ${r.sequence.length}`;
  $("#routineTitle").textContent = round.title;
  $("#routineSub").textContent = round.subtitle + (round.breaths ? ` · ${round.breaths} 個深呼吸節奏` : "");
  $("#routineCurrent").textContent = `現在：${current}`;
  $("#routineCue").textContent = currentCue();
  $("#routineNext").textContent = `接下來：${next}`;
}

function selectRoutineExercise({announce=true}={}) {
  if (!routineActive) return;
  const name = currentExerciseName();
  const btn = findExerciseButton(name);
  if (!btn) return;
  advancing = true;
  btn.click();
  lastRep = Number($("#stageRepValue")?.textContent || 0);
  updateRoutineHud();
  setTimeout(() => { advancing = false; }, 700);
  if (announce) {
    const round = currentRound();
    routineSpeak(`${round.title}。現在進行${name}。${currentCue()}`, `routine-${routineMode}-${roundIndex}-${exerciseIndex}`);
  }
}

function startRoutine(mode) {
  routineMode = mode;
  routineActive = true;
  roundIndex = 0;
  exerciseIndex = 0;
  advancing = false;
  clickMode(mode);
  $("#routineHud").hidden = false;
  setTimeout(() => {
    selectRoutineExercise();
    $("#startCameraBtn")?.click();
  }, 120);
}

function stopRoutine() {
  routineActive = false;
  advancing = false;
  $("#routineHud").hidden = true;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

function advanceRoutine() {
  if (!routineActive || advancing) return;
  const r = ROUTINES[routineMode];
  advancing = true;

  if (exerciseIndex < r.sequence.length - 1) {
    const finished = currentExerciseName();
    exerciseIndex++;
    const next = currentExerciseName();
    routineSpeak(`${finished}完成。接下來，${next}。`, `transition-${roundIndex}-${exerciseIndex}`);
    setTimeout(() => selectRoutineExercise({announce:false}), 1500);
    return;
  }

  if (roundIndex < r.rounds.length - 1) {
    const completedRound = roundIndex + 1;
    roundIndex++;
    exerciseIndex = 0;
    const nextRound = currentRound();
    updateRoutineHud();
    routineSpeak(`第${completedRound}回合完成。${nextRound.title}。${nextRound.subtitle}。`, `round-${roundIndex}`);
    setTimeout(() => selectRoutineExercise({announce:false}), 2200);
    return;
  }

  routineSpeak(`三個回合全部完成。做得很好，慢慢放鬆，恢復自然呼吸。`, "routine-complete");
  $("#routineProgress").textContent = "✓ 3 / 3 回合完成";
  $("#routineTitle").textContent = "✨ 完成整套課程";
  $("#routineSub").textContent = "慢慢放鬆，恢復自然呼吸";
  $("#routineCurrent").textContent = "今天的連續課程完成";
  $("#routineCue").textContent = "可以輕輕甩甩手、轉轉肩膀，再回到工作。";
  $("#routineNext").textContent = "";
  routineActive = false;
  advancing = false;
}

function watchCompletion() {
  const repNode = $("#stageRepValue");
  if (!repNode || observer) return;
  observer = new MutationObserver(() => {
    if (!routineActive || advancing) return;
    const value = Number(repNode.textContent || 0);
    if (value > lastRep && value >= 1) {
      lastRep = value;
      advanceRoutine();
    }
  });
  observer.observe(repNode, { childList:true, characterData:true, subtree:true });
}

window.addEventListener("DOMContentLoaded", () => {
  injectRoutineUI();
  watchCompletion();
});
