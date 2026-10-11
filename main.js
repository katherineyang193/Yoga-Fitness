import { FilesetResolver, PoseLandmarker, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

const MODES = {
  office: {
    title: "久坐救援",
    exercises: [
      { id:"side-stretch", name:"側腰伸展", subtitle:"可站可坐・左右各一次為 1 組", instruction:"跟著提示完成左側、回正、右側、回正。左右都完成才算 1 組。", type:"guided", targetHold:4, tracking:"upper" },
      { id:"overhead-stretch", name:"雙手上舉伸展", subtitle:"可站可坐・上半身", instruction:"坐著或站著都可以，雙手舉過頭頂，手臂伸長，肩膀放鬆。", type:"hold", targetHold:6, tracking:"upper" },
      { id:"seated-twist", name:"坐姿扭轉", subtitle:"坐姿・肩背與腰部", instruction:"坐穩後保持背部拉長，雙手打開，軀幹慢慢轉向一側。", type:"hold", targetHold:6, tracking:"upper" }
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
const video=$("#webcam"),canvas=$("#overlay"),ctx=canvas.getContext("2d"),cameraWrap=$("#cameraWrap"),cameraPlaceholder=$("#cameraPlaceholder"),cameraState=$("#cameraState"),mirrorBtn=$("#mirrorBtn"),startCameraBtn=$("#startCameraBtn"),resetBtn=$("#resetBtn"),exitWorkoutBtn=$("#exitWorkoutBtn"),modeTitle=$("#modeTitle"),exerciseCount=$("#exerciseCount"),exerciseList=$("#exerciseList"),exerciseName=$("#exerciseName"),exerciseInstruction=$("#exerciseInstruction"),scoreValue=$("#scoreValue"),scoreRing=$("#scoreRing"),coachMessage=$("#coachMessage"),detailMessage=$("#detailMessage"),holdValue=$("#holdValue"),repValue=$("#repValue"),repLabel=$("#repLabel"),visibilityValue=$("#visibilityValue"),holdBar=$("#holdBar"),stageExerciseName=$("#stageExerciseName"),stageInstruction=$("#stageInstruction"),stageCoachMessage=$("#stageCoachMessage"),stageDetailMessage=$("#stageDetailMessage"),stageScoreValue=$("#stageScoreValue"),stageHoldValue=$("#stageHoldValue"),stageRepValue=$("#stageRepValue"),stageRepLabel=$("#stageRepLabel"),stageHoldBar=$("#stageHoldBar"),trackingRequirement=$("#trackingRequirement"),placeholderHint=$("#placeholderHint"),virtualCoachFigure=$("#virtualCoachFigure"),virtualCoachLabel=$("#virtualCoachLabel");

let currentMode="office",currentExercise=MODES.office.exercises[0],poseLandmarker=null,drawingUtils=null,stream=null,running=false,mirrored=true,lastVideoTime=-1,lastFrameTimestamp=performance.now(),holdSeconds=0,reps=0,squatState="up",trackingAcquired=false,holdLatched=false;
let guidedPhase="left",guidedCenterSeconds=0;

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function angle(a,b,c){const ab={x:a.x-b.x,y:a.y-b.y},cb={x:c.x-b.x,y:c.y-b.y},dot=ab.x*cb.x+ab.y*cb.y,ma=Math.hypot(ab.x,ab.y),mc=Math.hypot(cb.x,cb.y);if(!ma||!mc)return 0;return Math.acos(clamp(dot/(ma*mc),-1,1))*180/Math.PI}
const j=(lm,i)=>lm[i];
const scoreNear=(v,t,tol)=>clamp(1-Math.abs(v-t)/tol,0,1);

function requiredLandmarks(){return currentExercise.tracking==="upper"?[L.NOSE,L.LS,L.RS,L.LE,L.RE,L.LW,L.RW,L.LH,L.RH]:[L.NOSE,L.LS,L.RS,L.LH,L.RH,L.LK,L.RK,L.LA,L.RA]}
function visibilityScore(lm){const vals=requiredLandmarks().map(i=>lm[i]?.visibility??0);return vals.reduce((a,b)=>a+b,0)/vals.length}
function trackingThreshold(){return currentExercise.tracking==="upper"?0.48:0.60}
function trackingCopy(){return currentExercise.tracking==="upper"?{badge:"👤 上半身辨識｜坐著也可以",placeholder:"這個動作只需要頭、肩、手臂與腰部入鏡，可以坐著做。",lost:"把頭、肩、雙手和腰部留在畫面裡，不需要拍到腳。"}:{badge:"🧍 全身辨識｜請讓膝蓋與腳踝入鏡",placeholder:"這個動作需要全身入鏡，請往後站到膝蓋與腳踝都看得到。",lost:"請往後一些，讓頭、肩、髖、膝和腳踝都在畫面裡。"}}

function personSvg(pose="neutral",step=""){const upper={neutral:{rot:0,la:"M92 102 L72 138",ra:"M148 102 L168 138"},left:{rot:-17,la:"M92 102 L70 132",ra:"M148 101 L156 62 L160 28"},right:{rot:17,la:"M92 101 L84 62 L80 28",ra:"M148 102 L170 132"},overhead:{rot:0,la:"M92 102 L82 60 L80 25",ra:"M148 102 L158 60 L160 25"},open:{rot:0,la:"M92 105 L54 104 L22 98",ra:"M148 105 L186 104 L218 98"}}[pose]||{rot:0,la:"M92 102 L72 138",ra:"M148 102 L168 138"};
 const seated=pose==="seated";
 const squat=pose==="squat";
 const warrior=pose==="warrior";
 const tree=pose==="tree";
 const lunge=pose==="lunge";
 let legs='<path class="avatar-leg" d="M105 167 L96 248"/><path class="avatar-leg" d="M135 167 L144 248"/><path class="avatar-shoe" d="M88 252 L103 252"/><path class="avatar-shoe" d="M137 252 L153 252"/>';
 if(seated)legs='<path class="avatar-leg" d="M106 168 L79 198 L48 198"/><path class="avatar-leg" d="M134 168 L161 198 L192 198"/><path class="coach-ground" d="M56 207 L184 207"/>';
 if(squat)legs='<path class="avatar-leg" d="M106 166 L82 199 L68 248"/><path class="avatar-leg" d="M134 166 L158 199 L172 248"/><path class="avatar-shoe" d="M58 252 L73 252"/><path class="avatar-shoe" d="M167 252 L182 252"/>';
 if(warrior)legs='<path class="avatar-leg" d="M107 166 L79 197 L50 248"/><path class="avatar-leg" d="M133 166 L166 184 L207 214"/><path class="avatar-shoe" d="M40 252 L58 252"/><path class="avatar-shoe" d="M202 218 L220 218"/>';
 if(tree)legs='<path class="avatar-leg" d="M112 166 L108 248"/><path class="avatar-leg" d="M133 166 L155 192 L116 201"/><path class="avatar-shoe" d="M100 252 L116 252"/>';
 if(lunge)legs='<path class="avatar-leg" d="M108 166 L78 199 L49 248"/><path class="avatar-leg" d="M133 166 L162 201 L205 248"/><path class="avatar-shoe" d="M39 252 L58 252"/><path class="avatar-shoe" d="M198 252 L218 252"/>';
 const openArms=(warrior||lunge)?{la:"M92 103 L54 103 L20 103",ra:"M148 103 L186 103 L220 103"}:upper;
 const torsoRot=(warrior||tree||lunge||squat||seated)?0:upper.rot;
 const arms=(warrior||lunge)?openArms:upper;
 const upperMarkup=`<g transform="rotate(${torsoRot} 120 160)"><circle class="avatar-head" cx="120" cy="46" r="24"/><path class="avatar-hair" d="M97 43 Q101 18 120 18 Q143 18 145 45 Q135 31 120 31 Q105 31 97 43Z"/><circle class="avatar-eye" cx="112" cy="46" r="2.5"/><circle class="avatar-eye" cx="128" cy="46" r="2.5"/><path class="avatar-smile" d="M114 56 Q120 61 126 56"/><path class="avatar-shirt" d="M93 86 Q120 73 147 86 L153 163 Q120 178 87 163Z"/><path class="avatar-skin" d="${arms.la}"/><path class="avatar-skin" d="${arms.ra}"/></g>`;
 const motion=pose==="left"?'<path class="motion-path" d="M66 70 Q39 102 52 145"/><text class="motion-text" x="18" y="120">往左</text>':pose==="right"?'<path class="motion-path" d="M174 70 Q201 102 188 145"/><text class="motion-text" x="174" y="120">往右</text>':pose==="overhead"?'<path class="motion-path" d="M66 54 L66 18 M174 54 L174 18"/><text class="motion-text" x="91" y="20">向上</text>':pose==="squat"?'<path class="motion-path" d="M120 180 L120 224"/><text class="motion-text" x="132" y="218">下蹲</text>':'';
 const badge=step?`<g transform="translate(72 270)"><rect class="coach-step-badge" x="0" y="0" rx="14" width="96" height="28"/><text class="coach-step-text" x="48" y="19" text-anchor="middle">${step}</text></g>`:'';
 return `<svg viewBox="0 0 240 305" role="img" aria-label="虛擬教練動作示範"><line class="coach-ground" x1="38" y1="260" x2="202" y2="260"/>${legs}${upperMarkup}${motion}${badge}</svg>`}

function phaseInfo(){if(currentExercise.id!=="side-stretch")return null;switch(guidedPhase){case"left":return{pose:"left",label:"步驟 1 / 4｜往你的左側伸展",main:"← 左側伸展",detail:"右手舉高，身體往你的左側彎。維持 4 秒。"};case"center1":return{pose:"neutral",label:"步驟 2 / 4｜回到中間",main:"回到中間",detail:"身體回正，雙手放下。準備換另一邊。"};case"right":return{pose:"right",label:"步驟 3 / 4｜往你的右側伸展",main:"右側伸展 →",detail:"左手舉高，身體往你的右側彎。維持 4 秒。"};case"center2":return{pose:"neutral",label:"步驟 4 / 4｜回到中間",main:"回到中間",detail:"身體回正、雙手放下。完成後會自動算 1 組。"};default:return null}}

function coachPoseForExercise(){if(currentExercise.id==="side-stretch")return phaseInfo()?.pose||"neutral";if(currentExercise.id==="overhead-stretch")return"overhead";if(currentExercise.id==="seated-twist")return"seated";if(currentExercise.id==="tree")return"tree";if(currentExercise.id==="warrior2")return"warrior";if(currentExercise.id==="squat")return"squat";if(currentExercise.id==="lunge")return"lunge";return"neutral"}
function renderVirtualCoach(){const phase=phaseInfo();virtualCoachFigure.innerHTML=personSvg(coachPoseForExercise(),phase?phase.label.replace(/｜.*/,""):"");virtualCoachLabel.textContent=phase?phase.label:(currentExercise.tracking==="upper"?"可站可坐，跟著人物慢慢做":"跟著人物保持全身姿勢")}
function applyTrackingUI(){const c=trackingCopy();trackingRequirement.textContent=c.badge;placeholderHint.textContent=c.placeholder}
function updateRepLabel(){const label=currentExercise.type==="reps"?"完成次數":"完成組數";repLabel.textContent=label;stageRepLabel.textContent=label}

function resetExerciseState(){holdSeconds=0;reps=0;squatState="up";trackingAcquired=false;holdLatched=false;guidedPhase="left";guidedCenterSeconds=0;updateRepLabel();syncMetrics();setScore(0);renderVirtualCoach()}

function evaluateGuidedSideStretch(lm,dt){const ls=j(lm,L.LS),rs=j(lm,L.RS),le=j(lm,L.LE),re=j(lm,L.RE),lw=j(lm,L.LW),rw=j(lm,L.RW),lh=j(lm,L.LH),rh=j(lm,L.RH);const shoulderCenter=(ls.x+rs.x)/2,hipCenter=(lh.x+rh.x)/2,shift=Math.abs(shoulderCenter-hipCenter),leftElbow=angle(ls,le,lw),rightElbow=angle(rs,re,rw),leftHigh=ls.y-lw.y>.08&&leftElbow>140,rightHigh=rs.y-rw.y>.08&&rightElbow>140,centered=shift<.035&&lw.y>ls.y-.02&&rw.y>rs.y-.02;let score=0,main="",detail="";
 if(guidedPhase==="left"){const good=rightHigh&&shift>.025;score=100*clamp((rightHigh?0.55:0)+(shift*7),0,1);holdSeconds=good?holdSeconds+dt:Math.max(0,holdSeconds-dt*.8);const p=phaseInfo();main=p.main;detail=good?`很好，維持 ${Math.max(0,4-holdSeconds).toFixed(1)} 秒`:`${p.detail}`;if(holdSeconds>=4){guidedPhase="center1";holdSeconds=0;guidedCenterSeconds=0;renderVirtualCoach();const n=phaseInfo();main="✓ 左側完成！";detail=n.detail}}
 else if(guidedPhase==="center1"){score=centered?100:40;holdSeconds=0;guidedCenterSeconds=centered?guidedCenterSeconds+dt:0;const p=phaseInfo();main=p.main;detail=p.detail;if(guidedCenterSeconds>=.8){guidedPhase="right";guidedCenterSeconds=0;renderVirtualCoach();const n=phaseInfo();main=n.main;detail=n.detail}}
 else if(guidedPhase==="right"){const good=leftHigh&&shift>.025;score=100*clamp((leftHigh?0.55:0)+(shift*7),0,1);holdSeconds=good?holdSeconds+dt:Math.max(0,holdSeconds-dt*.8);const p=phaseInfo();main=p.main;detail=good?`很好，維持 ${Math.max(0,4-holdSeconds).toFixed(1)} 秒`:`${p.detail}`;if(holdSeconds>=4){guidedPhase="center2";holdSeconds=0;guidedCenterSeconds=0;renderVirtualCoach();const n=phaseInfo();main="✓ 右側完成！";detail=n.detail}}
 else{score=centered?100:40;holdSeconds=0;guidedCenterSeconds=centered?guidedCenterSeconds+dt:0;const p=phaseInfo();main=p.main;detail=p.detail;if(guidedCenterSeconds>=.8){reps++;guidedPhase="left";guidedCenterSeconds=0;renderVirtualCoach();const n=phaseInfo();main=`✨ 完成 ${reps} 組！`;detail=`下一組：${n.detail}`}}
 return{score:Math.round(score),message:main,detail};}

function evaluateExercise(lm,dt){if(currentExercise.id==="side-stretch")return evaluateGuidedSideStretch(lm,dt);const ls=j(lm,L.LS),rs=j(lm,L.RS),le=j(lm,L.LE),re=j(lm,L.RE),lw=j(lm,L.LW),rw=j(lm,L.RW),lh=j(lm,L.LH),rh=j(lm,L.RH),lk=j(lm,L.LK),rk=j(lm,L.RK),la=j(lm,L.LA),ra=j(lm,L.RA);const leftElbow=angle(ls,le,lw),rightElbow=angle(rs,re,rw),leftKnee=lk&&la?angle(lh,lk,la):180,rightKnee=rk&&ra?angle(rh,rk,ra):180,shoulderLevel=Math.abs(ls.y-rs.y),hipLevel=Math.abs(lh.y-rh.y);let score=0,message="保持姿勢",detail="正在比對關節角度。";
 switch(currentExercise.id){case"overhead-stretch":{const high=((ls.y-lw.y)+(rs.y-rw.y))/2,straight=(scoreNear(leftElbow,175,35)+scoreNear(rightElbow,175,35))/2;score=100*clamp((high*3.2+straight)/2,0,1);message=high>.10?"很好！手臂繼續往上延伸":"雙手再舉高一點";detail="坐著也可以，保持肩膀放鬆，不要聳肩。";break}case"seated-twist":{const shoulderCenter=(ls.x+rs.x)/2,hipCenter=(lh.x+rh.x)/2,twist=Math.abs(shoulderCenter-hipCenter),armsOpen=Math.abs(lw.x-rw.x);score=100*clamp(twist*6+armsOpen*.75,0,1);message=twist>.035?"轉到了！慢慢維持":"軀幹再轉向一側";detail="骨盆保持穩定，轉胸口與肩膀，不要硬扭。";break}case"tree":{const leftLift=Math.abs(la.y-rk.y),rightLift=Math.abs(ra.y-lk.y),lifted=Math.min(leftLift,rightLift),stable=1-clamp((shoulderLevel+hipLevel)*4,0,1);score=100*clamp((stable+(1-clamp(lifted*3,0,1)))/2,0,1);message=stable>.72?"身體很穩！繼續維持":"軀幹再直一些，先求穩";detail="視線看前方固定點會比較穩。";break}case"warrior2":{const arms=1-clamp((Math.abs(lw.y-ls.y)+Math.abs(rw.y-rs.y))*3.5,0,1),front=Math.min(leftKnee,rightKnee),back=Math.max(leftKnee,rightKnee),ks=(scoreNear(front,105,45)+scoreNear(back,170,30))/2;score=100*clamp((arms+ks)/2,0,1);message=arms>.72?"手臂高度很好！":"雙手抬到肩膀高度";detail=front>135?"前腿再彎一些。":"前後腿狀態不錯，維持住。";break}case"lunge":{const front=Math.min(leftKnee,rightKnee),back=Math.max(leftKnee,rightKnee),ks=(scoreNear(front,100,45)+scoreNear(back,145,55))/2,torso=1-clamp((shoulderLevel+hipLevel)*3,0,1);score=100*clamp((ks+torso)/2,0,1);message=front<140?"很好！保持軀幹直立":"前腿再彎一點";detail="先求穩定，不追求過大的跨步。";break}case"squat":{const avg=(leftKnee+rightKnee)/2;if(avg<112&&squatState==="up")squatState="down";if(avg>158&&squatState==="down"){squatState="up";reps++}score=100*clamp((170-avg)/70,0,1);if(squatState==="down"){message="蹲到了！慢慢站回來";detail=`膝關節平均約 ${Math.round(avg)}°。`}else{message=avg<145?"再蹲低一些":"準備下一次深蹲";detail="完整下蹲再站起才會計 1 次。"}break}}
 const good=score>=72;if(currentExercise.type==="hold"){holdSeconds=good?holdSeconds+dt:Math.max(0,holdSeconds-dt*.7);if(holdSeconds>=currentExercise.targetHold&&!holdLatched){reps++;holdLatched=true;message=`✨ 完成 ${reps} 組！`;detail="回到自然姿勢後，可以再做下一組。"}if(!good&&holdSeconds<.4)holdLatched=false}else if(currentExercise.type!=="guided")holdSeconds=0;return{score:Math.round(clamp(score,0,100)),message,detail};}

function setScore(score){scoreValue.textContent=score;stageScoreValue.textContent=score;scoreRing.style.background=`conic-gradient(#d8b633 ${score*3.6}deg,#e2e8e3 0deg)`}
function setCoachText(main,detail){coachMessage.textContent=main;detailMessage.textContent=detail;stageCoachMessage.textContent=main;stageDetailMessage.textContent=detail}
function syncMetrics(){holdValue.textContent=`${holdSeconds.toFixed(1)}s`;stageHoldValue.textContent=`${holdSeconds.toFixed(1)}s`;repValue.textContent=reps;stageRepValue.textContent=reps;const target=currentExercise.targetHold||1,progress=(currentExercise.type==="hold"||currentExercise.type==="guided")?clamp(holdSeconds/target,0,1)*100:0;holdBar.style.width=`${progress}%`;stageHoldBar.style.width=`${progress}%`}
function setTrackingState(state){cameraWrap.classList.toggle("tracking-ok",state==="ok");cameraWrap.classList.toggle("tracking-poor",state==="poor")}
function renderExerciseList(){const mode=MODES[currentMode];modeTitle.textContent=mode.title;exerciseCount.textContent=mode.exercises.length;exerciseList.innerHTML="";mode.exercises.forEach(ex=>{const b=document.createElement("button");b.type="button";b.className=`exercise-btn${ex.id===currentExercise.id?" active":""}`;b.innerHTML=`<strong>${ex.name}</strong><small>${ex.subtitle}</small>`;b.addEventListener("click",()=>selectExercise(ex));exerciseList.appendChild(b)})}
function selectExercise(ex){currentExercise=ex;exerciseName.textContent=ex.name;exerciseInstruction.textContent=ex.instruction;stageExerciseName.textContent=ex.name;stageInstruction.textContent=ex.instruction;resetExerciseState();applyTrackingUI();setCoachText(running?"準備好後開始動作":"按下「開始運動」",running?trackingCopy().lost:"開始後看中央提示與右側示範人物。");renderExerciseList()}

async function createPoseLandmarker(){if(poseLandmarker)return poseLandmarker;cameraState.textContent="載入姿勢模型…";stageCoachMessage.textContent="正在載入動作辨識…";const vision=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");poseLandmarker=await PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",delegate:"GPU"},runningMode:"VIDEO",numPoses:1,minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5});drawingUtils=new DrawingUtils(ctx);return poseLandmarker}
function enterWorkoutUI(){document.body.classList.add("workout-active");exitWorkoutBtn.hidden=false;stageExerciseName.textContent=currentExercise.name;stageInstruction.textContent=currentExercise.instruction;applyTrackingUI();renderVirtualCoach()}
async function requestWorkoutFullscreen(){enterWorkoutUI();if(!document.fullscreenElement&&document.documentElement.requestFullscreen){try{await document.documentElement.requestFullscreen()}catch(_){}}}
async function startCamera(){requestWorkoutFullscreen();setTrackingState("none");trackingAcquired=false;setCoachText("正在開啟鏡頭…",trackingCopy().lost);try{await createPoseLandmarker();stream?.getTracks().forEach(t=>t.stop());stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:1280},height:{ideal:720}},audio:false});video.srcObject=stream;await video.play();running=true;cameraPlaceholder.classList.add("hidden");cameraState.textContent=currentExercise.tracking==="upper"?"尋找上半身…":"尋找全身…";startCameraBtn.textContent="重新啟動鏡頭";syncMirror();lastFrameTimestamp=performance.now();requestAnimationFrame(predictLoop)}catch(e){console.error(e);cameraState.textContent="無法啟動鏡頭";setCoachText("鏡頭或姿勢模型啟動失敗","請確認已允許攝影機權限，並使用 HTTPS 開啟。")}}
function syncCanvasSize(){const w=video.videoWidth||1280,h=video.videoHeight||720;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}}

function drawResult(result){ctx.clearRect(0,0,canvas.width,canvas.height);if(!result.landmarks?.length)return;const lm=result.landmarks[0];ctx.save();ctx.globalCompositeOperation="source-over";ctx.shadowColor="rgba(255,216,77,.95)";ctx.shadowBlur=26;drawingUtils.drawConnectors(lm,PoseLandmarker.POSE_CONNECTIONS,{color:"rgba(255,225,104,.38)",lineWidth:18});ctx.shadowBlur=14;drawingUtils.drawConnectors(lm,PoseLandmarker.POSE_CONNECTIONS,{color:"rgba(255,245,180,.62)",lineWidth:6});ctx.restore()}

function updateCoach(lm,dt){const visible=visibilityScore(lm),pct=Math.round(visible*100),threshold=trackingThreshold();visibilityValue.textContent=`${pct}%`;if(visible<threshold){trackingAcquired=false;setTrackingState("poor");cameraState.textContent=`入鏡 ${pct}%`;setScore(0);setCoachText(currentExercise.tracking==="upper"?"請把上半身留在畫面裡":"請讓全身完整進入畫面",trackingCopy().lost);holdSeconds=0;guidedCenterSeconds=0;syncMetrics();return}setTrackingState("ok");cameraState.textContent=currentExercise.tracking==="upper"?"✓ 已辨識，可以開始":"✓ 已辨識，可以開始";if(!trackingAcquired){trackingAcquired=true;const p=phaseInfo();setCoachText(p?p.main:"找到你了！開始動作",p?p.detail:currentExercise.instruction)}const ev=evaluateExercise(lm,dt);setScore(ev.score);setCoachText(ev.message,ev.detail);syncMetrics()}
function predictLoop(){if(!running||!poseLandmarker||video.readyState<2)return;syncCanvasSize();const now=performance.now(),dt=Math.min((now-lastFrameTimestamp)/1000,.1);lastFrameTimestamp=now;if(video.currentTime!==lastVideoTime){lastVideoTime=video.currentTime;const result=poseLandmarker.detectForVideo(video,now);drawResult(result);if(result.landmarks?.length)updateCoach(result.landmarks[0],dt);else{trackingAcquired=false;setTrackingState("none");visibilityValue.textContent="--";cameraState.textContent=currentExercise.tracking==="upper"?"尋找上半身…":"尋找人體…";setCoachText("站到鏡頭中央",trackingCopy().lost)}}requestAnimationFrame(predictLoop)}
function syncMirror(){video.classList.toggle("mirrored",mirrored);canvas.classList.toggle("mirrored",mirrored);mirrorBtn.textContent=`鏡像：${mirrored?"開":"關"}`}
async function exitWorkout(){document.body.classList.remove("workout-active");exitWorkoutBtn.hidden=true;if(document.fullscreenElement&&document.exitFullscreen){try{await document.exitFullscreen()}catch(_){}}}
function resetSession(){resetExerciseState();setTrackingState("none");setCoachText("已重新校正",trackingCopy().lost)}

document.querySelectorAll(".mode-card").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".mode-card").forEach(i=>i.classList.remove("active"));b.classList.add("active");currentMode=b.dataset.mode;selectExercise(MODES[currentMode].exercises[0])}));
mirrorBtn.addEventListener("click",()=>{mirrored=!mirrored;syncMirror()});startCameraBtn.addEventListener("click",startCamera);resetBtn.addEventListener("click",resetSession);exitWorkoutBtn.addEventListener("click",exitWorkout);
document.addEventListener("fullscreenchange",()=>{if(!document.fullscreenElement&&document.body.classList.contains("workout-active")&&!running)document.body.classList.remove("workout-active")});
syncMirror();renderExerciseList();selectExercise(currentExercise);