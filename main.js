import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

const MODES = {
  office: {
    title: "久坐救援",
    exercises: [
      { id:"side-stretch", name:"側腰伸展", subtitle:"可站可坐・左右各一次為 1 組", instruction:"跟著提示完成左側、回正、右側、回正。左右都完成才算 1 組。", type:"guided", targetHold:3, tracking:"upper" },
      { id:"overhead-stretch", name:"雙手上舉伸展", subtitle:"可站可坐・上半身", instruction:"坐著或站著都可以，雙手舉過頭頂，手臂伸長，肩膀放鬆。", type:"hold", targetHold:5, tracking:"upper" },
      { id:"seated-twist", name:"坐姿扭轉", subtitle:"坐姿・肩背與腰部", instruction:"坐穩後保持背部拉長，雙手打開，軀幹慢慢轉向一側。", type:"hold", targetHold:5, tracking:"upper" }
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
      { id:"squat", name:"深蹲 Squat", subtitle:"側身較佳・完整蹲下再站起", instruction:"側身站好，慢慢下蹲，達標後再站回直立。完整回正才計 1 次。", type:"reps", targetHold:0, tracking:"full" },
      { id:"lunge", name:"弓箭步 Lunge", subtitle:"側身較佳・前後腿穩定", instruction:"側身站好，一腳向前跨步，前後腿彎曲，維持後再回到站姿。", type:"hold", targetHold:5, tracking:"full" }
    ]
  }
};

const L={NOSE:0,LS:11,RS:12,LE:13,RE:14,LW:15,RW:16,LH:23,RH:24,LK:25,RK:26,LA:27,RA:28};
const $=s=>document.querySelector(s);

const video=$("#webcam"), canvas=$("#overlay"), ctx=canvas.getContext("2d");
const cameraWrap=$("#cameraWrap"), cameraPlaceholder=$("#cameraPlaceholder"), cameraState=$("#cameraState");
const mirrorBtn=$("#mirrorBtn"), startCameraBtn=$("#startCameraBtn"), resetBtn=$("#resetBtn"), exitWorkoutBtn=$("#exitWorkoutBtn");
const modeTitle=$("#modeTitle"), exerciseCount=$("#exerciseCount"), exerciseList=$("#exerciseList");
const exerciseName=$("#exerciseName"), exerciseInstruction=$("#exerciseInstruction");
const scoreValue=$("#scoreValue"), scoreRing=$("#scoreRing"), coachMessage=$("#coachMessage"), detailMessage=$("#detailMessage");
const holdValue=$("#holdValue"), repValue=$("#repValue"), repLabel=$("#repLabel"), visibilityValue=$("#visibilityValue"), holdBar=$("#holdBar");
const stageExerciseName=$("#stageExerciseName"), stageInstruction=$("#stageInstruction"), stageCoachMessage=$("#stageCoachMessage"), stageDetailMessage=$("#stageDetailMessage");
const stageScoreValue=$("#stageScoreValue"), stageHoldValue=$("#stageHoldValue"), stageRepValue=$("#stageRepValue"), stageRepLabel=$("#stageRepLabel"), stageHoldBar=$("#stageHoldBar");
const trackingRequirement=$("#trackingRequirement"), placeholderHint=$("#placeholderHint"), virtualCoachFigure=$("#virtualCoachFigure"), virtualCoachLabel=$("#virtualCoachLabel");
const ttsToggleBtn=$("#ttsToggleBtn"), ttsVolume=$("#ttsVolume"), ttsVolumeWrap=$("#ttsVolumeWrap");

let currentMode="office", currentExercise=MODES.office.exercises[0];
let poseLandmarker=null, stream=null, running=false, mirrored=true, lastVideoTime=-1, lastFrameTimestamp=performance.now();
let holdSeconds=0, reps=0, trackingAcquired=false, holdLatched=false, trackingReady=false;
let guidedPhase="left", guidedCenterSeconds=0, squatState="standing";
let lastSpokenKey="", lastSpokenAt=0;
let ttsEnabled=localStorage.getItem("yf_tts")!=="off";
let ttsVol=Number(localStorage.getItem("yf_tts_volume") ?? 0.8);

const maskCanvas=document.createElement("canvas");
const maskCtx=maskCanvas.getContext("2d",{willReadFrequently:true});
let maskImageData=null;

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function angle(a,b,c){
  if(!a||!b||!c)return 0;
  const ab={x:a.x-b.x,y:a.y-b.y}, cb={x:c.x-b.x,y:c.y-b.y};
  const dot=ab.x*cb.x+ab.y*cb.y, ma=Math.hypot(ab.x,ab.y), mc=Math.hypot(cb.x,cb.y);
  if(!ma||!mc)return 0;
  return Math.acos(clamp(dot/(ma*mc),-1,1))*180/Math.PI;
}
const j=(lm,i)=>lm[i];
const scoreNear=(v,t,tol)=>clamp(1-Math.abs(v-t)/tol,0,1);

function requiredLandmarks(){
  return currentExercise.tracking==="upper"
    ? [L.NOSE,L.LS,L.RS,L.LE,L.RE,L.LW,L.RW,L.LH,L.RH]
    : [L.NOSE,L.LS,L.RS,L.LH,L.RH,L.LK,L.RK,L.LA,L.RA];
}
function visibilityScore(lm){
  const vals=requiredLandmarks().map(i=>lm[i]?.visibility??0);
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}
function trackingThreshold(){return currentExercise.tracking==="upper"?0.44:0.60}
function trackingCopy(){
  return currentExercise.tracking==="upper"
    ? {badge:"👤 上半身辨識｜坐著也可以",placeholder:"這個動作只需要頭、肩、手臂與腰部入鏡，可以坐著做。",lost:"把頭、肩、雙手和腰部留在畫面裡，不需要拍到腳。"}
    : {badge:"🧍 全身辨識｜請讓膝蓋與腳踝入鏡",placeholder:"這個動作需要全身入鏡，請往後站到膝蓋與腳踝都看得到。",lost:"請往後一些，讓頭、肩、髖、膝和腳踝都在畫面裡。"};
}

function applyTTSUI(){
  ttsToggleBtn.textContent=ttsEnabled?"🔊 語音":"🔇 靜音";
  ttsToggleBtn.setAttribute("aria-pressed",String(ttsEnabled));
  ttsVolume.value=String(ttsVol);
  ttsVolumeWrap.classList.toggle("off",!ttsEnabled);
}
function cancelSpeech(){ if("speechSynthesis" in window) speechSynthesis.cancel(); }
function speak(text,key,{force=false}={}){
  if(!ttsEnabled || !("speechSynthesis" in window) || !text)return;
  const now=performance.now();
  if(!force && key===lastSpokenKey && now-lastSpokenAt<5000)return;
  cancelSpeech();
  const u=new SpeechSynthesisUtterance(text.replace(/[←→✓✨]/g,""));
  u.lang="zh-TW"; u.rate=0.95; u.pitch=1; u.volume=ttsVol;
  speechSynthesis.speak(u);
  lastSpokenKey=key; lastSpokenAt=now;
}
function announce(main,detail,key,force=false){
  setCoachText(main,detail);
  speak(`${main}。${detail}`,key,{force});
}

function personSvg(pose="neutral",step=""){
  const frontHead='<circle class="avatar-head" cx="120" cy="46" r="24"/><path class="avatar-hair" d="M97 43 Q101 18 120 18 Q143 18 145 45 Q135 31 120 31 Q105 31 97 43Z"/><circle class="avatar-eye" cx="112" cy="46" r="2.5"/><circle class="avatar-eye" cx="128" cy="46" r="2.5"/><path class="avatar-smile" d="M114 56 Q120 61 126 56"/>';
  const badge=step?`<g transform="translate(72 270)"><rect class="coach-step-badge" x="0" y="0" rx="14" width="96" height="28"/><text class="coach-step-text" x="48" y="19" text-anchor="middle">${step}</text></g>`:"";
  const ground='<line class="coach-ground" x1="38" y1="260" x2="202" y2="260"/>';
  if(pose==="squat-side" || pose==="stand-side" || pose==="lunge-side"){
    let body="",motion="";
    if(pose==="stand-side"){
      body='<circle class="avatar-head" cx="118" cy="47" r="23"/><path class="avatar-hair" d="M96 43 Q102 18 121 20 Q140 22 144 44 Q132 33 118 33 Q106 33 96 43Z"/><path class="avatar-shirt" d="M103 82 Q121 75 136 85 L140 159 Q121 169 103 158Z"/><path class="avatar-skin" d="M112 95 L104 137"/><path class="avatar-leg" d="M116 160 L114 244"/><path class="avatar-leg" d="M128 160 L132 244"/><path class="avatar-shoe" d="M104 250 L119 250"/><path class="avatar-shoe" d="M126 250 L143 250"/>';
    } else if(pose==="squat-side"){
      body='<circle class="avatar-head" cx="144" cy="68" r="23"/><path class="avatar-hair" d="M122 64 Q128 39 147 41 Q166 43 170 65 Q158 54 144 54 Q132 54 122 64Z"/><path class="avatar-shirt" d="M116 98 Q137 91 151 104 L139 166 Q119 168 106 153Z"/><path class="avatar-skin" d="M128 109 L102 142"/><path class="avatar-leg" d="M117 160 L82 190 L65 238"/><path class="avatar-leg" d="M133 161 L164 190 L177 238"/><path class="avatar-shoe" d="M54 244 L73 244"/><path class="avatar-shoe" d="M168 244 L188 244"/>';
      motion='<path class="motion-path" d="M151 89 Q164 114 152 143"/><text class="motion-text" x="164" y="126">下蹲</text>';
    } else {
      body='<circle class="avatar-head" cx="121" cy="49" r="23"/><path class="avatar-hair" d="M99 45 Q105 20 124 22 Q143 24 147 46 Q135 35 121 35 Q109 35 99 45Z"/><path class="avatar-shirt" d="M104 84 Q123 77 139 87 L142 160 Q121 170 103 159Z"/><path class="avatar-skin" d="M113 99 L104 140"/><path class="avatar-leg" d="M113 160 L77 190 L48 240"/><path class="avatar-leg" d="M132 160 L162 194 L207 238"/><path class="avatar-shoe" d="M38 246 L57 246"/><path class="avatar-shoe" d="M199 244 L219 244"/>';
      motion='<text class="motion-text" x="48" y="220">側身</text>';
    }
    return `<svg viewBox="0 0 240 305" role="img" aria-label="側身動作示範">${ground}${body}${motion}${badge}</svg>`;
  }

  let transform=0, arms='<path class="avatar-skin" d="M92 102 L72 138"/><path class="avatar-skin" d="M148 102 L168 138"/>', legs='<path class="avatar-leg" d="M105 167 L96 248"/><path class="avatar-leg" d="M135 167 L144 248"/><path class="avatar-shoe" d="M88 252 L103 252"/><path class="avatar-shoe" d="M137 252 L153 252"/>',motion="";
  if(pose==="left"){transform=-15;arms='<path class="avatar-skin" d="M92 102 L70 132"/><path class="avatar-skin" d="M148 101 L156 62 L160 28"/>';motion='<path class="motion-path" d="M66 70 Q39 102 52 145"/><text class="motion-text" x="18" y="120">往左</text>'}
  if(pose==="right"){transform=15;arms='<path class="avatar-skin" d="M92 101 L84 62 L80 28"/><path class="avatar-skin" d="M148 102 L170 132"/>';motion='<path class="motion-path" d="M174 70 Q201 102 188 145"/><text class="motion-text" x="174" y="120">往右</text>'}
  if(pose==="overhead"){arms='<path class="avatar-skin" d="M92 102 L82 60 L80 25"/><path class="avatar-skin" d="M148 102 L158 60 L160 25"/>';motion='<text class="motion-text" x="94" y="22">向上</text>'}
  if(pose==="seated"){legs='<path class="avatar-leg" d="M106 168 L79 198 L48 198"/><path class="avatar-leg" d="M134 168 L161 198 L192 198"/>';arms='<path class="avatar-skin" d="M92 105 L54 104 L22 98"/><path class="avatar-skin" d="M148 105 L186 104 L218 98"/>'}
  if(pose==="tree"){legs='<path class="avatar-leg" d="M112 166 L108 248"/><path class="avatar-leg" d="M133 166 L155 192 L116 201"/><path class="avatar-shoe" d="M100 252 L116 252"/>';arms='<path class="avatar-skin" d="M92 102 L76 72 L120 32"/><path class="avatar-skin" d="M148 102 L164 72 L120 32"/>'}
  if(pose==="warrior"){legs='<path class="avatar-leg" d="M107 166 L79 197 L50 248"/><path class="avatar-leg" d="M133 166 L166 184 L207 214"/>';arms='<path class="avatar-skin" d="M92 103 L54 103 L20 103"/><path class="avatar-skin" d="M148 103 L186 103 L220 103"/>'}
  return `<svg viewBox="0 0 240 305" role="img" aria-label="虛擬教練動作示範">${ground}${legs}<g transform="rotate(${transform} 120 160)">${frontHead}<path class="avatar-shirt" d="M93 86 Q120 73 147 86 L153 163 Q120 178 87 163Z"/>${arms}</g>${motion}${badge}</svg>`;
}

function phaseInfo(){
  if(currentExercise.id!=="side-stretch")return null;
  const data={
    left:{pose:"left",label:"步驟 1 / 4｜往你的左側伸展",main:"← 左側伸展",detail:"右手舉高，身體輕輕往你的左側彎。維持 3 秒。"},
    center1:{pose:"neutral",label:"步驟 2 / 4｜回到中間",main:"回到中間",detail:"身體回正，手放下。停一下就會換另一邊。"},
    right:{pose:"right",label:"步驟 3 / 4｜往你的右側伸展",main:"右側伸展 →",detail:"左手舉高，身體輕輕往你的右側彎。維持 3 秒。"},
    center2:{pose:"neutral",label:"步驟 4 / 4｜回到中間",main:"回到中間",detail:"身體回正、手放下，完成後自動算 1 組。"}
  };
  return data[guidedPhase];
}
function coachPoseForExercise(){
  if(currentExercise.id==="side-stretch")return phaseInfo()?.pose||"neutral";
  if(currentExercise.id==="overhead-stretch")return"overhead";
  if(currentExercise.id==="seated-twist")return"seated";
  if(currentExercise.id==="tree")return"tree";
  if(currentExercise.id==="warrior2")return"warrior";
  if(currentExercise.id==="squat")return squatState==="down"?"squat-side":"stand-side";
  if(currentExercise.id==="lunge")return"lunge-side";
  return"neutral";
}
function renderVirtualCoach(){
  const phase=phaseInfo();
  virtualCoachFigure.innerHTML=personSvg(coachPoseForExercise(),phase?phase.label.replace(/｜.*/,""):"");
  if(phase)virtualCoachLabel.textContent=phase.label;
  else if(currentExercise.id==="squat")virtualCoachLabel.textContent=squatState==="down"?"蹲到了，接著站回來":"側身站好，準備慢慢下蹲";
  else if(currentExercise.id==="lunge")virtualCoachLabel.textContent="建議側身，會更容易看清前後腿角度";
  else virtualCoachLabel.textContent=currentExercise.tracking==="upper"?"可站可坐，跟著人物慢慢做":"跟著人物保持姿勢";
}
function applyTrackingUI(){const c=trackingCopy();trackingRequirement.textContent=c.badge;placeholderHint.textContent=c.placeholder}
function updateRepLabel(){const label=currentExercise.type==="reps"?"完成次數":"完成組數";repLabel.textContent=label;stageRepLabel.textContent=label}
function setScore(score){scoreValue.textContent=score;stageScoreValue.textContent=score;scoreRing.style.background=`conic-gradient(#7aa889 ${score*3.6}deg,#e2e8e3 0deg)`}
function setCoachText(main,detail){coachMessage.textContent=main;detailMessage.textContent=detail;stageCoachMessage.textContent=main;stageDetailMessage.textContent=detail}
function syncMetrics(){
  holdValue.textContent=`${holdSeconds.toFixed(1)}s`;stageHoldValue.textContent=`${holdSeconds.toFixed(1)}s`;
  repValue.textContent=reps;stageRepValue.textContent=reps;
  const target=currentExercise.targetHold||1,progress=currentExercise.type!=="reps"?clamp(holdSeconds/target,0,1)*100:0;
  holdBar.style.width=`${progress}%`;stageHoldBar.style.width=`${progress}%`;
}
function setTrackingState(state){cameraWrap.classList.toggle("tracking-ok",state==="ok");cameraWrap.classList.toggle("tracking-poor",state==="poor")}
function resetExerciseState(){
  holdSeconds=0;reps=0;trackingAcquired=false;trackingReady=false;holdLatched=false;guidedPhase="left";guidedCenterSeconds=0;squatState="standing";
  updateRepLabel();syncMetrics();setScore(0);renderVirtualCoach();
}

function evaluateGuidedSideStretch(lm,dt){
  const ls=j(lm,L.LS),rs=j(lm,L.RS),le=j(lm,L.LE),re=j(lm,L.RE),lw=j(lm,L.LW),rw=j(lm,L.RW),lh=j(lm,L.LH),rh=j(lm,L.RH);
  const shoulderX=(ls.x+rs.x)/2, hipX=(lh.x+rh.x)/2, dx=shoulderX-hipX;
  const rightRaised=(rs.y-rw.y)>.045 && angle(rs,re,rw)>118;
  const leftRaised=(ls.y-lw.y)>.045 && angle(ls,le,lw)>118;
  const armDown=(lw.y>ls.y-.015 || rw.y>rs.y-.015);
  const centered=Math.abs(dx)<.06 && armDown;
  const bendLeft=dx>.008, bendRight=dx<-.008;
  let score=0,main="",detail="";

  if(guidedPhase==="left"){
    const good=rightRaised && bendLeft;
    score=100*clamp((rightRaised?.62:0)+(Math.max(dx,0)*11),0,1);
    holdSeconds=good?holdSeconds+dt:Math.max(0,holdSeconds-dt*.25);
    const p=phaseInfo();main=p.main;detail=good?`很好，維持 ${Math.max(0,currentExercise.targetHold-holdSeconds).toFixed(1)} 秒`:p.detail;
    if(holdSeconds>=currentExercise.targetHold){
      guidedPhase="center1";holdSeconds=0;guidedCenterSeconds=0;renderVirtualCoach();
      const n=phaseInfo();main="✓ 左側完成！";detail=n.detail;
      speak(`${main}。${detail}`,"side-center1",{force:true});
    }
  } else if(guidedPhase==="center1"){
    score=centered?100:55;holdSeconds=0;guidedCenterSeconds=centered?guidedCenterSeconds+dt:Math.max(0,guidedCenterSeconds-dt*.2);
    const p=phaseInfo();main=p.main;detail=p.detail;
    if(guidedCenterSeconds>=.45){
      guidedPhase="right";guidedCenterSeconds=0;renderVirtualCoach();
      const n=phaseInfo();main=n.main;detail=n.detail;
      speak(`${main}。${detail}`,"side-right",{force:true});
    }
  } else if(guidedPhase==="right"){
    const good=leftRaised && bendRight;
    score=100*clamp((leftRaised?.62:0)+(Math.max(-dx,0)*11),0,1);
    holdSeconds=good?holdSeconds+dt:Math.max(0,holdSeconds-dt*.25);
    const p=phaseInfo();main=p.main;detail=good?`很好，維持 ${Math.max(0,currentExercise.targetHold-holdSeconds).toFixed(1)} 秒`:p.detail;
    if(holdSeconds>=currentExercise.targetHold){
      guidedPhase="center2";holdSeconds=0;guidedCenterSeconds=0;renderVirtualCoach();
      const n=phaseInfo();main="✓ 右側完成！";detail=n.detail;
      speak(`${main}。${detail}`,"side-center2",{force:true});
    }
  } else {
    score=centered?100:55;holdSeconds=0;guidedCenterSeconds=centered?guidedCenterSeconds+dt:Math.max(0,guidedCenterSeconds-dt*.2);
    const p=phaseInfo();main=p.main;detail=p.detail;
    if(guidedCenterSeconds>=.45){
      reps++;guidedPhase="left";guidedCenterSeconds=0;renderVirtualCoach();
      const n=phaseInfo();main=`✨ 完成 ${reps} 組！`;detail=`下一組。${n.detail}`;
      speak(`${main}。${detail}`,"side-next-"+reps,{force:true});
    }
  }
  return{score:Math.round(clamp(score,0,100)),message:main,detail};
}

function evaluateExercise(lm,dt){
  if(currentExercise.id==="side-stretch")return evaluateGuidedSideStretch(lm,dt);
  const ls=j(lm,L.LS),rs=j(lm,L.RS),le=j(lm,L.LE),re=j(lm,L.RE),lw=j(lm,L.LW),rw=j(lm,L.RW),lh=j(lm,L.LH),rh=j(lm,L.RH),lk=j(lm,L.LK),rk=j(lm,L.RK),la=j(lm,L.LA),ra=j(lm,L.RA);
  const leftElbow=angle(ls,le,lw),rightElbow=angle(rs,re,rw),leftKnee=angle(lh,lk,la),rightKnee=angle(rh,rk,ra),shoulderLevel=Math.abs(ls.y-rs.y),hipLevel=Math.abs(lh.y-rh.y);
  let score=0,message="保持姿勢",detail="正在比對關節角度。",good=false;

  if(currentExercise.id==="overhead-stretch"){
    const high=((ls.y-lw.y)+(rs.y-rw.y))/2,straight=(scoreNear(leftElbow,175,38)+scoreNear(rightElbow,175,38))/2;
    score=100*clamp((high*3.5+straight)/2,0,1);good=score>=62;
    message=high>.075?"很好！手臂繼續往上延伸":"雙手再舉高一點";detail="坐著也可以，肩膀放鬆，不需要聳肩。";
  } else if(currentExercise.id==="seated-twist"){
    const shoulderX=(ls.x+rs.x)/2,hipX=(lh.x+rh.x)/2,twist=Math.abs(shoulderX-hipX),arms=Math.abs(lw.x-rw.x);
    score=100*clamp(twist*7+arms*.7,0,1);good=score>=58;
    message=good?"轉到了！慢慢維持":"胸口與肩膀再轉一些";detail="骨盆保持穩定，不要硬扭。";
  } else if(currentExercise.id==="tree"){
    const lift=Math.min(Math.abs(la.y-rk.y),Math.abs(ra.y-lk.y)),stable=1-clamp((shoulderLevel+hipLevel)*4,0,1);
    score=100*clamp((stable+(1-clamp(lift*3,0,1)))/2,0,1);good=score>=70;message=stable>.72?"身體很穩！繼續維持":"軀幹再直一些，先求穩";detail="視線看前方固定點會比較穩。";
  } else if(currentExercise.id==="warrior2"){
    const arms=1-clamp((Math.abs(lw.y-ls.y)+Math.abs(rw.y-rs.y))*3.5,0,1),front=Math.min(leftKnee,rightKnee),back=Math.max(leftKnee,rightKnee),ks=(scoreNear(front,105,45)+scoreNear(back,170,30))/2;
    score=100*clamp((arms+ks)/2,0,1);good=score>=70;message=arms>.72?"手臂高度很好！":"雙手抬到肩膀高度";detail=front>135?"前腿再彎一些。":"前後腿狀態不錯，維持住。";
  } else if(currentExercise.id==="lunge"){
    const front=Math.min(leftKnee,rightKnee),back=Math.max(leftKnee,rightKnee),ks=(scoreNear(front,105,50)+scoreNear(back,150,55))/2;
    score=100*clamp(ks,0,1);good=score>=66;message=good?"弓箭步到了！維持住":"側身會更容易辨識，前腿再彎一些";detail="維持完成後回到站姿。";
  } else if(currentExercise.id==="squat"){
    const avg=(leftKnee+rightKnee)/2;
    if(squatState==="standing" && avg<125){squatState="down";renderVirtualCoach();speak("蹲到了，慢慢站回來","squat-down",{force:true});}
    if(squatState==="down" && avg>158){squatState="standing";reps++;renderVirtualCoach();speak(`站回來了，完成第 ${reps} 次`,"squat-up-"+reps,{force:true});}
    score=100*clamp((170-avg)/60,0,1);
    if(squatState==="down"){message="蹲到了！請慢慢站回來";detail="完整站直後才會計 1 次。";good=true}
    else{message=avg<145?"再蹲低一些":"側身站好，準備下一次";detail="側身較容易看清膝蓋角度。";good=false}
    holdSeconds=0;return{score:Math.round(score),message,detail};
  }

  if(currentExercise.type==="hold"){
    holdSeconds=good?holdSeconds+dt:Math.max(0,holdSeconds-dt*.35);
    if(holdSeconds>=currentExercise.targetHold && !holdLatched){
      holdLatched=true;reps++;
      speak(`完成第 ${reps} 組，請回到自然站姿`,"hold-done-"+currentExercise.id+"-"+reps,{force:true});
    }
    if(!good && holdSeconds<.5)holdLatched=false;
  }
  return{score:Math.round(clamp(score,0,100)),message,detail};
}

function renderExerciseList(){
  const mode=MODES[currentMode];modeTitle.textContent=mode.title;exerciseCount.textContent=mode.exercises.length;exerciseList.innerHTML="";
  mode.exercises.forEach(ex=>{
    const b=document.createElement("button");b.type="button";b.className=`exercise-btn${ex.id===currentExercise.id?" active":""}`;
    b.innerHTML=`<strong>${ex.name}</strong><small>${ex.subtitle}</small>`;b.addEventListener("click",()=>selectExercise(ex));exerciseList.appendChild(b);
  });
}
function selectExercise(ex){
  currentExercise=ex;exerciseName.textContent=ex.name;exerciseInstruction.textContent=ex.instruction;stageExerciseName.textContent=ex.name;stageInstruction.textContent=ex.instruction;
  resetExerciseState();applyTrackingUI();renderVirtualCoach();
  setCoachText(running?"準備好後開始動作":"按下「開始運動」",running?trackingCopy().lost:"開始後看中央提示、右側示範人物，也可以聽語音。");
  renderExerciseList();
}

async function createPoseLandmarker(){
  if(poseLandmarker)return poseLandmarker;
  cameraState.textContent="載入姿勢模型…";stageCoachMessage.textContent="正在載入動作辨識…";
  const vision=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
  poseLandmarker=await PoseLandmarker.createFromOptions(vision,{
    baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",delegate:"GPU"},
    runningMode:"VIDEO",numPoses:1,minPoseDetectionConfidence:.45,minPosePresenceConfidence:.45,minTrackingConfidence:.45,
    outputSegmentationMasks:true
  });
  return poseLandmarker;
}
function enterWorkoutUI(){document.body.classList.add("workout-active");exitWorkoutBtn.hidden=false;stageExerciseName.textContent=currentExercise.name;stageInstruction.textContent=currentExercise.instruction;applyTrackingUI();renderVirtualCoach()}
async function requestWorkoutFullscreen(){enterWorkoutUI();if(!document.fullscreenElement&&document.documentElement.requestFullscreen){try{await document.documentElement.requestFullscreen()}catch(_){}}}
async function startCamera(){
  requestWorkoutFullscreen();setTrackingState("none");trackingAcquired=false;trackingReady=false;announce("正在開啟鏡頭…",trackingCopy().lost,"camera-start",true);
  try{
    await createPoseLandmarker();stream?.getTracks().forEach(t=>t.stop());
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:1280},height:{ideal:720}},audio:false});
    video.srcObject=stream;await video.play();running=true;cameraPlaceholder.classList.add("hidden");
    cameraState.textContent=currentExercise.tracking==="upper"?"尋找上半身…":"尋找全身…";startCameraBtn.textContent="重新啟動鏡頭";
    syncMirror();lastFrameTimestamp=performance.now();requestAnimationFrame(predictLoop);
  }catch(e){console.error(e);cameraState.textContent="無法啟動鏡頭";announce("鏡頭或姿勢模型啟動失敗","請確認已允許攝影機權限，並使用 HTTPS 開啟。","camera-error",true)}
}
function syncCanvasSize(){const w=video.videoWidth||1280,h=video.videoHeight||720;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}}

function drawFallbackGlow(lm){
  ctx.save();ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle="rgba(255,220,76,.28)";ctx.shadowColor="rgba(255,216,77,.95)";ctx.shadowBlur=30;ctx.lineWidth=28;
  const pairs=[[L.LS,L.RS],[L.LS,L.LE],[L.LE,L.LW],[L.RS,L.RE],[L.RE,L.RW],[L.LS,L.LH],[L.RS,L.RH],[L.LH,L.RH],[L.LH,L.LK],[L.LK,L.LA],[L.RH,L.RK],[L.RK,L.RA]];
  const sx=canvas.width,sy=canvas.height;ctx.beginPath();
  for(const [a,b] of pairs){const p=lm[a],q=lm[b];if(!p||!q)continue;ctx.moveTo(p.x*sx,p.y*sy);ctx.lineTo(q.x*sx,q.y*sy)}
  ctx.stroke();ctx.restore();
}
function drawBodyGlow(result){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(!trackingReady || !result.landmarks?.length)return;
  const mask=result.segmentationMasks?.[0];
  if(!mask){drawFallbackGlow(result.landmarks[0]);return}
  try{
    const w=mask.width,h=mask.height,data=mask.getAsFloat32Array();
    if(maskCanvas.width!==w||maskCanvas.height!==h){maskCanvas.width=w;maskCanvas.height=h;maskImageData=maskCtx.createImageData(w,h)}
    const px=maskImageData.data;
    for(let i=0,j=0;i<data.length;i++,j+=4){
      const a=data[i]>.48?255:0;px[j]=255;px[j+1]=230;px[j+2]=92;px[j+3]=a;
    }
    maskCtx.putImageData(maskImageData,0,0);
    ctx.save();
    ctx.globalCompositeOperation="source-over";ctx.globalAlpha=.98;ctx.filter="blur(24px)";ctx.drawImage(maskCanvas,0,0,canvas.width,canvas.height);
    ctx.globalAlpha=.82;ctx.filter="blur(11px)";ctx.drawImage(maskCanvas,0,0,canvas.width,canvas.height);
    ctx.globalAlpha=.7;ctx.filter="blur(4px)";ctx.drawImage(maskCanvas,0,0,canvas.width,canvas.height);
    ctx.globalCompositeOperation="destination-out";ctx.globalAlpha=1;ctx.filter="none";ctx.drawImage(maskCanvas,0,0,canvas.width,canvas.height);
    ctx.restore();
  }catch(_){drawFallbackGlow(result.landmarks[0])}
}

function updateCoach(lm,dt){
  const visible=visibilityScore(lm),pct=Math.round(visible*100),threshold=trackingThreshold();visibilityValue.textContent=`${pct}%`;
  if(visible<threshold){
    trackingAcquired=false;trackingReady=false;setTrackingState("poor");cameraState.textContent=`入鏡 ${pct}%`;setScore(0);
    setCoachText(currentExercise.tracking==="upper"?"請把上半身留在畫面裡":"請讓全身完整進入畫面",trackingCopy().lost);
    holdSeconds=0;guidedCenterSeconds=0;syncMetrics();return;
  }
  trackingReady=true;setTrackingState("ok");cameraState.textContent="✓ 已辨識，可以開始";
  if(!trackingAcquired){
    trackingAcquired=true;const p=phaseInfo();
    announce(p?p.main:"找到你了！開始動作",p?p.detail:currentExercise.instruction,"tracking-ready-"+currentExercise.id,true);
  }
  const ev=evaluateExercise(lm,dt);setScore(ev.score);setCoachText(ev.message,ev.detail);syncMetrics();
}

function predictLoop(){
  if(!running||!poseLandmarker||video.readyState<2)return;
  syncCanvasSize();const now=performance.now(),dt=Math.min((now-lastFrameTimestamp)/1000,.1);lastFrameTimestamp=now;
  if(video.currentTime!==lastVideoTime){
    lastVideoTime=video.currentTime;const result=poseLandmarker.detectForVideo(video,now);
    if(result.landmarks?.length)updateCoach(result.landmarks[0],dt);
    else{trackingAcquired=false;trackingReady=false;setTrackingState("none");visibilityValue.textContent="--";cameraState.textContent=currentExercise.tracking==="upper"?"尋找上半身…":"尋找人體…";setCoachText("站到鏡頭中央",trackingCopy().lost)}
    drawBodyGlow(result);
  }
  requestAnimationFrame(predictLoop);
}
function syncMirror(){video.classList.toggle("mirrored",mirrored);canvas.classList.toggle("mirrored",mirrored);mirrorBtn.textContent=`鏡像：${mirrored?"開":"關"}`}
async function exitWorkout(){document.body.classList.remove("workout-active");exitWorkoutBtn.hidden=true;cancelSpeech();if(document.fullscreenElement&&document.exitFullscreen){try{await document.exitFullscreen()}catch(_){}}}
function resetSession(){resetExerciseState();setTrackingState("none");setCoachText("已重新校正",trackingCopy().lost);speak("已重新校正，請回到畫面中央","reset", {force:true})}

document.querySelectorAll(".mode-card").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll(".mode-card").forEach(i=>i.classList.remove("active"));b.classList.add("active");currentMode=b.dataset.mode;selectExercise(MODES[currentMode].exercises[0]);
}));
mirrorBtn.addEventListener("click",()=>{mirrored=!mirrored;syncMirror()});
startCameraBtn.addEventListener("click",startCamera);resetBtn.addEventListener("click",resetSession);exitWorkoutBtn.addEventListener("click",exitWorkout);
ttsToggleBtn.addEventListener("click",()=>{
  ttsEnabled=!ttsEnabled;localStorage.setItem("yf_tts",ttsEnabled?"on":"off");applyTTSUI();
  if(!ttsEnabled)cancelSpeech();else speak("語音提示已開啟","tts-on",{force:true});
});
ttsVolume.addEventListener("input",()=>{
  ttsVol=Number(ttsVolume.value);localStorage.setItem("yf_tts_volume",String(ttsVol));applyTTSUI();
});
document.addEventListener("fullscreenchange",()=>{if(!document.fullscreenElement&&document.body.classList.contains("workout-active")&&!running)document.body.classList.remove("workout-active")});

applyTTSUI();syncMirror();renderExerciseList();selectExercise(currentExercise);