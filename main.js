import { FilesetResolver, PoseLandmarker, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

const MODES = {
  office: {
    title: "久坐救援",
    exercises: [
      { id:"side-stretch", name:"側腰伸展", subtitle:"可站可坐・上半身", instruction:"坐著或站著都可以，單手舉高，身體慢慢往另一側延伸。", type:"hold", targetHold:6, tracking:"upper" },
      { id:"overhead-stretch", name:"雙手上舉伸展", subtitle:"可站可坐・上半身", instruction:"坐著或站著都可以，雙手舉過頭頂，手臂伸長，肩膀放鬆。", type:"hold", targetHold:6, tracking:"upper" },
      { id:"seated-twist", name:"坐姿扭轉", subtitle:"坐姿・肩背與腰部", instruction:"坐穩後保持背部拉長，雙手在胸前或向兩側打開，軀幹慢慢轉向一側。", type:"hold", targetHold:6, tracking:"upper" }
    ]
  },
  yoga: {
    title: "站姿瑜珈",
    exercises: [
      { id:"tree", name:"樹式 Tree Pose", subtitle:"全身・平衡穩定", instruction:"單腳站立，另一腳抬起靠近支撐腿，軀幹保持直立。", type:"hold", targetHold:8, tracking:"full" },
      { id:"warrior2", name:"戰士二式 Warrior II", subtitle:"全身・腿部肩膀", instruction:"雙手向左右伸平，前腿彎曲、後腿伸直，軀幹保持挺直。", type:"hold", targetHold:8, tracking:"full" }
    ]
  },
  fitness: {
    title: "基礎健身",
    exercises: [
      { id:"squat", name:"深蹲 Squat", subtitle:"全身・動作計數", instruction:"雙腳站穩後下蹲，再完整站起。完整下蹲再站回來才計 1 次。", type:"reps", targetHold:0, tracking:"full" },
      { id:"lunge", name:"弓箭步 Lunge", subtitle:"全身・下肢穩定", instruction:"一腳向前，前後腿彎曲並保持軀幹直立。", type:"hold", targetHold:6, tracking:"full" }
    ]
  }
};

const L={NOSE:0,LS:11,RS:12,LE:13,RE:14,LW:15,RW:16,LH:23,RH:24,LK:25,RK:26,LA:27,RA:28};
const $=s=>document.querySelector(s);
const video=$("#webcam"),canvas=$("#overlay"),ctx=canvas.getContext("2d"),cameraWrap=$("#cameraWrap"),cameraPlaceholder=$("#cameraPlaceholder"),cameraState=$("#cameraState"),mirrorBtn=$("#mirrorBtn"),startCameraBtn=$("#startCameraBtn"),resetBtn=$("#resetBtn"),exitWorkoutBtn=$("#exitWorkoutBtn"),modeTitle=$("#modeTitle"),exerciseCount=$("#exerciseCount"),exerciseList=$("#exerciseList"),exerciseName=$("#exerciseName"),exerciseInstruction=$("#exerciseInstruction"),scoreValue=$("#scoreValue"),scoreRing=$("#scoreRing"),coachMessage=$("#coachMessage"),detailMessage=$("#detailMessage"),holdValue=$("#holdValue"),repValue=$("#repValue"),visibilityValue=$("#visibilityValue"),holdBar=$("#holdBar"),stageExerciseName=$("#stageExerciseName"),stageInstruction=$("#stageInstruction"),stageCoachMessage=$("#stageCoachMessage"),stageDetailMessage=$("#stageDetailMessage"),stageScoreValue=$("#stageScoreValue"),stageHoldValue=$("#stageHoldValue"),stageRepValue=$("#stageRepValue"),stageHoldBar=$("#stageHoldBar"),trackingRequirement=$("#trackingRequirement"),placeholderHint=$("#placeholderHint"),virtualCoachFigure=$("#virtualCoachFigure"),virtualCoachLabel=$("#virtualCoachLabel");

let currentMode="office",currentExercise=MODES.office.exercises[0],poseLandmarker=null,drawingUtils=null,stream=null,running=false,mirrored=true,lastVideoTime=-1,lastFrameTimestamp=performance.now(),holdSeconds=0,reps=0,squatState="up",trackingAcquired=false;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function angle(a,b,c){const ab={x:a.x-b.x,y:a.y-b.y},cb={x:c.x-b.x,y:c.y-b.y},dot=ab.x*cb.x+ab.y*cb.y,ma=Math.hypot(ab.x,ab.y),mc=Math.hypot(cb.x,cb.y);if(!ma||!mc)return 0;return Math.acos(clamp(dot/(ma*mc),-1,1))*180/Math.PI}
const j=(lm,i)=>lm[i];
const scoreNear=(v,t,tol)=>clamp(1-Math.abs(v-t)/tol,0,1);

function requiredLandmarks(){return currentExercise.tracking==="upper"?[L.NOSE,L.LS,L.RS,L.LE,L.RE,L.LW,L.RW,L.LH,L.RH]:[L.NOSE,L.LS,L.RS,L.LH,L.RH,L.LK,L.RK,L.LA,L.RA]}
function visibilityScore(lm){const vals=requiredLandmarks().map(i=>lm[i]?.visibility??0);return vals.reduce((a,b)=>a+b,0)/vals.length}
function trackingThreshold(){return currentExercise.tracking==="upper"?0.48:0.60}
function trackingCopy(){return currentExercise.tracking==="upper"?{badge:"👤 上半身辨識｜坐著也可以",placeholder:"這個動作只需要頭、肩、手臂與腰部入鏡，可以坐著做。",lost:"把頭、肩、雙手和腰部留在畫面裡，不需要拍到腳。"}:{badge:"🧍 全身辨識｜請讓膝蓋與腳踝入鏡",placeholder:"這個動作需要全身入鏡，請往後站到膝蓋與腳踝都看得到。",lost:"請往後一些，讓頭、肩、髖、膝和腳踝都在畫面裡。"}}

function coachSvg(id){
 const head='<circle class="coach-head" cx="100" cy="42" r="21"/><ellipse class="coach-core" cx="100" cy="98" rx="27" ry="39"/>';
 const ground='<line class="coach-ground" x1="35" y1="230" x2="165" y2="230"/>';
 const wrap=b=>`<svg viewBox="0 0 200 250" role="img" aria-label="動作示範">${ground}${head}${b}</svg>`;
 if(id==="overhead-stretch")return wrap('<path class="coach-body" d="M88 84 L68 58 L56 22 M112 84 L132 58 L144 22 M90 130 L82 205 M110 130 L118 205"/><path class="coach-accent" d="M56 22 L56 8 M144 22 L144 8"/>');
 if(id==="side-stretch")return wrap('<path class="coach-body" d="M88 84 L66 66 L45 82 M112 83 L128 55 L138 22 M93 132 L78 205 M108 132 L115 205"/><path class="coach-accent" d="M100 72 Q82 105 75 145"/><text class="motion-arrow" x="44" y="130">←</text>');
 if(id==="seated-twist")return wrap('<path class="coach-body" d="M86 88 L54 92 L28 80 M114 88 L146 92 L172 80 M92 132 L70 165 L46 166 M108 132 L130 165 L154 166"/><path class="coach-accent" d="M82 82 Q100 66 118 82"/><text class="motion-arrow" x="143" y="48">↻</text>');
 if(id==="tree")return wrap('<path class="coach-body" d="M88 84 L62 60 L100 22 M112 84 L138 60 L100 22 M96 132 L90 205 M108 132 L128 162 L94 171"/>');
 if(id==="warrior2")return wrap('<path class="coach-body" d="M86 88 L48 88 L14 88 M114 88 L152 88 L186 88 M92 132 L62 162 L38 205 M108 132 L140 146 L176 176"/><path class="coach-accent" d="M14 88 L4 88 M186 88 L196 88"/>');
 if(id==="squat")return wrap('<path class="coach-body" d="M86 88 L58 105 L35 122 M114 88 L142 105 L165 122 M92 128 L68 158 L50 205 M108 128 L132 158 L150 205"/><text class="motion-arrow" x="91" y="220">↓</text>');
 if(id==="lunge")return wrap('<path class="coach-body" d="M86 88 L60 80 L38 72 M114 88 L140 80 L162 72 M92 132 L60 160 L34 205 M108 132 L135 166 L172 205"/>');
 return wrap('<path class="coach-body" d="M88 84 L58 100 M112 84 L142 100 M92 132 L82 205 M108 132 L118 205"/>')
}
function renderVirtualCoach(){virtualCoachFigure.innerHTML=coachSvg(currentExercise.id);virtualCoachLabel.textContent=currentExercise.tracking==="upper"?"可站可坐，跟著人物慢慢做":"跟著人物保持全身姿勢"}
function applyTrackingUI(){const c=trackingCopy();trackingRequirement.textContent=c.badge;placeholderHint.textContent=c.placeholder}

function evaluateExercise(lm,dt){
 const ls=j(lm,L.LS),rs=j(lm,L.RS),le=j(lm,L.LE),re=j(lm,L.RE),lw=j(lm,L.LW),rw=j(lm,L.RW),lh=j(lm,L.LH),rh=j(lm,L.RH),lk=j(lm,L.LK),rk=j(lm,L.RK),la=j(lm,L.LA),ra=j(lm,L.RA);
 const leftElbow=angle(ls,le,lw),rightElbow=angle(rs,re,rw),leftKnee=lk&&la?angle(lh,lk,la):180,rightKnee=rk&&ra?angle(rh,rk,ra):180,shoulderLevel=Math.abs(ls.y-rs.y),hipLevel=Math.abs(lh.y-rh.y);
 let score=0,message="保持姿勢",detail="正在比對關節角度。";
 switch(currentExercise.id){
  case"overhead-stretch":{const high=((ls.y-lw.y)+(rs.y-rw.y))/2,straight=(scoreNear(leftElbow,175,35)+scoreNear(rightElbow,175,35))/2;score=100*clamp((high*3.2+straight)/2,0,1);message=high>.10?"很好！手臂繼續往上延伸":"雙手再舉高一點";detail="坐著也可以，保持肩膀放鬆，不要聳肩。";break}
  case"side-stretch":{const high=Math.max(ls.y-lw.y,rs.y-rw.y),shift=Math.abs((ls.x+rs.x)/2-(lh.x+rh.x)/2);score=100*clamp((high*3+shift*5)/2,0,1);message=shift>.035?"有伸展到！維持住":"上半身再往側邊延伸";detail="不用拍到腿，坐著或站著都可以。";break}
  case"seated-twist":{const shoulderCenter=(ls.x+rs.x)/2,hipCenter=(lh.x+rh.x)/2,twist=Math.abs(shoulderCenter-hipCenter),armsOpen=(Math.abs(lw.x-rw.x));score=100*clamp(twist*6+armsOpen*.75,0,1);message=twist>.035?"轉到了！慢慢維持":"軀幹再轉向一側";detail="骨盆保持穩定，轉胸口與肩膀，不要硬扭。";break}
  case"tree":{const leftLift=Math.abs(la.y-rk.y),rightLift=Math.abs(ra.y-lk.y),lifted=Math.min(leftLift,rightLift),stable=1-clamp((shoulderLevel+hipLevel)*4,0,1);score=100*clamp((stable+(1-clamp(lifted*3,0,1)))/2,0,1);message=stable>.72?"身體很穩！繼續維持":"軀幹再直一些，先求穩";detail="視線看前方固定點會比較穩。";break}
  case"warrior2":{const arms=1-clamp((Math.abs(lw.y-ls.y)+Math.abs(rw.y-rs.y))*3.5,0,1),front=Math.min(leftKnee,rightKnee),back=Math.max(leftKnee,rightKnee),ks=(scoreNear(front,105,45)+scoreNear(back,170,30))/2;score=100*clamp((arms+ks)/2,0,1);message=arms>.72?"手臂高度很好！":"雙手抬到肩膀高度";detail=front>135?"前腿再彎一些。":"前後腿狀態不錯，維持住。";break}
  case"lunge":{const front=Math.min(leftKnee,rightKnee),back=Math.max(leftKnee,rightKnee),ks=(scoreNear(front,100,45)+scoreNear(back,145,55))/2,torso=1-clamp((shoulderLevel+hipLevel)*3,0,1);score=100*clamp((ks+torso)/2,0,1);message=front<140?"很好！保持軀幹直立":"前腿再彎一點";detail="先求穩定，不追求過大的跨步。";break}
  case"squat":{const avg=(leftKnee+rightKnee)/2;if(avg<112&&squatState==="up")squatState="down";if(avg>158&&squatState==="down"){squatState="up";reps++}score=100*clamp((170-avg)/70,0,1);if(squatState==="down"){message="蹲到了！慢慢站回來";detail=`膝關節平均約 ${Math.round(avg)}°。`}else{message=avg<145?"再蹲低一些":"準備下一次深蹲";detail="完整下蹲再站起才會計 1 次。"}break}
 }
 const good=score>=72;if(currentExercise.type==="hold")holdSeconds=good?holdSeconds+dt:Math.max(0,holdSeconds-dt*.7);else holdSeconds=0;
 return{score:Math.round(clamp(score,0,100)),message,detail}
}

function setScore(score){scoreValue.textContent=score;stageScoreValue.textContent=score;scoreRing.style.background=`conic-gradient(#7aa889 ${score*3.6}deg,#e2e8e3 0deg)`}
function setCoachText(main,detail){coachMessage.textContent=main;detailMessage.textContent=detail;stageCoachMessage.textContent=main;stageDetailMessage.textContent=detail}
function syncMetrics(){holdValue.textContent=`${holdSeconds.toFixed(1)}s`;stageHoldValue.textContent=`${holdSeconds.toFixed(1)}s`;repValue.textContent=reps;stageRepValue.textContent=reps;const target=currentExercise.targetHold||1,progress=currentExercise.type==="hold"?clamp(holdSeconds/target,0,1)*100:0;holdBar.style.width=`${progress}%`;stageHoldBar.style.width=`${progress}%`}
function setTrackingState(state){cameraWrap.classList.toggle("tracking-ok",state==="ok");cameraWrap.classList.toggle("tracking-poor",state==="poor")}
function renderExerciseList(){const mode=MODES[currentMode];modeTitle.textContent=mode.title;exerciseCount.textContent=mode.exercises.length;exerciseList.innerHTML="";mode.exercises.forEach(ex=>{const b=document.createElement("button");b.type="button";b.className=`exercise-btn${ex.id===currentExercise.id?" active":""}`;b.innerHTML=`<strong>${ex.name}</strong><small>${ex.subtitle}</small>`;b.addEventListener("click",()=>selectExercise(ex));exerciseList.appendChild(b)})}
function selectExercise(ex){currentExercise=ex;exerciseName.textContent=ex.name;exerciseInstruction.textContent=ex.instruction;stageExerciseName.textContent=ex.name;stageInstruction.textContent=ex.instruction;holdSeconds=0;reps=0;squatState="up";trackingAcquired=false;syncMetrics();setScore(0);applyTrackingUI();renderVirtualCoach();setCoachText(running?"準備好後開始動作":"按下「開始運動」",running?trackingCopy().lost:"開始後看中央提示與右側示範人物。");renderExerciseList()}

async function createPoseLandmarker(){if(poseLandmarker)return poseLandmarker;cameraState.textContent="載入姿勢模型…";stageCoachMessage.textContent="正在載入動作辨識…";const vision=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");poseLandmarker=await PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",delegate:"GPU"},runningMode:"VIDEO",numPoses:1,minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5});drawingUtils=new DrawingUtils(ctx);return poseLandmarker}
function enterWorkoutUI(){document.body.classList.add("workout-active");exitWorkoutBtn.hidden=false;stageExerciseName.textContent=currentExercise.name;stageInstruction.textContent=currentExercise.instruction;applyTrackingUI();renderVirtualCoach()}
async function requestWorkoutFullscreen(){enterWorkoutUI();if(!document.fullscreenElement&&document.documentElement.requestFullscreen){try{await document.documentElement.requestFullscreen()}catch(_){}}}
async function startCamera(){requestWorkoutFullscreen();setTrackingState("none");trackingAcquired=false;setCoachText("正在開啟鏡頭…",trackingCopy().lost);try{await createPoseLandmarker();stream?.getTracks().forEach(t=>t.stop());stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:1280},height:{ideal:720}},audio:false});video.srcObject=stream;await video.play();running=true;cameraPlaceholder.classList.add("hidden");cameraState.textContent=currentExercise.tracking==="upper"?"尋找上半身…":"尋找全身…";startCameraBtn.textContent="重新啟動鏡頭";syncMirror();lastFrameTimestamp=performance.now();requestAnimationFrame(predictLoop)}catch(e){console.error(e);cameraState.textContent="無法啟動鏡頭";setCoachText("鏡頭或姿勢模型啟動失敗","請確認已允許攝影機權限，並使用 HTTPS 開啟。")}}
function syncCanvasSize(){const w=video.videoWidth||1280,h=video.videoHeight||720;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}}
function drawResult(result){ctx.clearRect(0,0,canvas.width,canvas.height);if(!result.landmarks?.length)return;const lm=result.landmarks[0];drawingUtils.drawConnectors(lm,PoseLandmarker.POSE_CONNECTIONS,{color:"#8cffaa",lineWidth:5});drawingUtils.drawLandmarks(lm,{color:"#fff",fillColor:"#1f7a45",radius:4})}
function updateCoach(lm,dt){const visible=visibilityScore(lm),pct=Math.round(visible*100),threshold=trackingThreshold();visibilityValue.textContent=`${pct}%`;if(visible<threshold){trackingAcquired=false;setTrackingState("poor");cameraState.textContent=`入鏡 ${pct}%`;setScore(0);setCoachText(currentExercise.tracking==="upper"?"請把上半身留在畫面裡":"請讓全身完整進入畫面",trackingCopy().lost);holdSeconds=0;syncMetrics();return}setTrackingState("ok");cameraState.textContent=currentExercise.tracking==="upper"?"✓ 上半身辨識成功":"✓ 全身辨識成功";if(!trackingAcquired){trackingAcquired=true;setCoachText("找到你了！開始動作",currentExercise.instruction)}const ev=evaluateExercise(lm,dt);setScore(ev.score);setCoachText(ev.message,ev.detail);syncMetrics();if(currentExercise.type==="hold"&&holdSeconds>=currentExercise.targetHold)setCoachText("✨ 完成！姿勢維持成功","做得很好，可以放鬆回到自然姿勢。")}
function predictLoop(){if(!running||!poseLandmarker||video.readyState<2)return;syncCanvasSize();const now=performance.now(),dt=Math.min((now-lastFrameTimestamp)/1000,.1);lastFrameTimestamp=now;if(video.currentTime!==lastVideoTime){lastVideoTime=video.currentTime;const result=poseLandmarker.detectForVideo(video,now);drawResult(result);if(result.landmarks?.length)updateCoach(result.landmarks[0],dt);else{trackingAcquired=false;setTrackingState("none");visibilityValue.textContent="--";cameraState.textContent=currentExercise.tracking==="upper"?"尋找上半身…":"尋找人體…";setCoachText("站到鏡頭中央",trackingCopy().lost)}}requestAnimationFrame(predictLoop)}
function syncMirror(){video.classList.toggle("mirrored",mirrored);canvas.classList.toggle("mirrored",mirrored);mirrorBtn.textContent=`鏡像：${mirrored?"開":"關"}`}
async function exitWorkout(){document.body.classList.remove("workout-active");exitWorkoutBtn.hidden=true;if(document.fullscreenElement&&document.exitFullscreen){try{await document.exitFullscreen()}catch(_){}}}
function resetSession(){holdSeconds=0;reps=0;squatState="up";trackingAcquired=false;setTrackingState("none");syncMetrics();setScore(0);setCoachText("已重新校正",trackingCopy().lost)}

document.querySelectorAll(".mode-card").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".mode-card").forEach(i=>i.classList.remove("active"));b.classList.add("active");currentMode=b.dataset.mode;selectExercise(MODES[currentMode].exercises[0])}));
mirrorBtn.addEventListener("click",()=>{mirrored=!mirrored;syncMirror()});startCameraBtn.addEventListener("click",startCamera);resetBtn.addEventListener("click",resetSession);exitWorkoutBtn.addEventListener("click",exitWorkout);
document.addEventListener("fullscreenchange",()=>{if(!document.fullscreenElement&&document.body.classList.contains("workout-active")&&!running)document.body.classList.remove("workout-active")});
syncMirror();renderExerciseList();selectExercise(currentExercise);
