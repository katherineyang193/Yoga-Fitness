import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

const MODES = {
  office: {
    title: "久坐救援",
    exercises: [
      { id:"side-stretch", name:"側腰伸展", subtitle:"左右伸展＋回正", instruction:"左側伸展、回正、右側伸展、回正，完整完成才算 1 組。", tracking:"upper" },
      { id:"overhead-stretch", name:"雙手上舉伸展", subtitle:"上舉＋維持＋放下", instruction:"從自然姿勢開始，雙手舉高維持，再放回自然姿勢。", tracking:"upper" },
      { id:"seated-twist", name:"坐姿扭轉", subtitle:"左右扭轉＋回正", instruction:"坐穩後向左扭轉、回正，再向右扭轉、回正。", tracking:"upper" }
    ]
  },
  yoga: {
    title: "站姿瑜珈",
    exercises: [
      { id:"tree", name:"樹式 Tree Pose", subtitle:"左右腿平衡＋回正", instruction:"完成一側樹式後回到雙腳站立，再換另一側。", tracking:"full" },
      { id:"warrior2", name:"戰士二式 Warrior II", subtitle:"左右側＋回正", instruction:"雙手伸平，一側腿彎曲維持，回正後換另一側。", tracking:"full" }
    ]
  },
  fitness: {
    title: "基礎健身",
    exercises: [
      { id:"squat", name:"深蹲 Squat", subtitle:"側身較佳・蹲下再站起", instruction:"側身站好，慢慢下蹲，達標後完整站回來才算 1 次。", tracking:"full" },
      { id:"lunge", name:"弓箭步 Lunge", subtitle:"側身較佳・左右交換", instruction:"側身，一腳跨出做弓箭步，維持後回正，再換另一腳。", tracking:"full" }
    ]
  }
};

const L={NOSE:0,LS:11,RS:12,LE:13,RE:14,LW:15,RW:16,LH:23,RH:24,LK:25,RK:26,LA:27,RA:28};
const $=s=>document.querySelector(s);
const video=$("#webcam"),canvas=$("#overlay"),ctx=canvas.getContext("2d");
const cameraWrap=$("#cameraWrap"),cameraPlaceholder=$("#cameraPlaceholder"),cameraState=$("#cameraState");
const mirrorBtn=$("#mirrorBtn"),startCameraBtn=$("#startCameraBtn"),resetBtn=$("#resetBtn"),exitWorkoutBtn=$("#exitWorkoutBtn");
const modeTitle=$("#modeTitle"),exerciseCount=$("#exerciseCount"),exerciseList=$("#exerciseList");
const exerciseName=$("#exerciseName"),exerciseInstruction=$("#exerciseInstruction"),scoreValue=$("#scoreValue"),scoreRing=$("#scoreRing");
const coachMessage=$("#coachMessage"),detailMessage=$("#detailMessage"),holdValue=$("#holdValue"),repValue=$("#repValue"),repLabel=$("#repLabel"),visibilityValue=$("#visibilityValue"),holdBar=$("#holdBar");
const stageExerciseName=$("#stageExerciseName"),stageInstruction=$("#stageInstruction"),stageCoachMessage=$("#stageCoachMessage"),stageDetailMessage=$("#stageDetailMessage"),stageScoreValue=$("#stageScoreValue"),stageHoldValue=$("#stageHoldValue"),stageRepValue=$("#stageRepValue"),stageRepLabel=$("#stageRepLabel"),stageHoldBar=$("#stageHoldBar");
const trackingRequirement=$("#trackingRequirement"),placeholderHint=$("#placeholderHint"),virtualCoachFigure=$("#virtualCoachFigure"),virtualCoachLabel=$("#virtualCoachLabel");
const ttsToggleBtn=$("#ttsToggleBtn"),ttsVolume=$("#ttsVolume"),ttsVolumeWrap=$("#ttsVolumeWrap");

let currentMode="office",currentExercise=MODES.office.exercises[0];
let poseLandmarker=null,stream=null,running=false,mirrored=true,lastVideoTime=-1,lastFrameTimestamp=performance.now();
let reps=0,holdSeconds=0,phase="",phaseStable=0,trackingReady=false,trackingAcquired=false,lowVisibilityFrames=0;
let lastSpokenKey="",lastSpokenAt=0,ttsEnabled=localStorage.getItem("yf_tts")!=="off",ttsVol=Number(localStorage.getItem("yf_tts_volume")??0.8);

const maskCanvas=document.createElement("canvas"),maskCtx=maskCanvas.getContext("2d",{willReadFrequently:true});
const edgeCanvas=document.createElement("canvas"),edgeCtx=edgeCanvas.getContext("2d",{willReadFrequently:true});
let maskImageData=null,edgeImageData=null,smoothedMask=null;

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function angle(a,b,c){if(!a||!b||!c)return 0;const ab={x:a.x-b.x,y:a.y-b.y},cb={x:c.x-b.x,y:c.y-b.y};const dot=ab.x*cb.x+ab.y*cb.y,ma=Math.hypot(ab.x,ab.y),mc=Math.hypot(cb.x,cb.y);if(!ma||!mc)return 0;return Math.acos(clamp(dot/(ma*mc),-1,1))*180/Math.PI;}
const j=(lm,i)=>lm[i];
const scoreNear=(v,t,tol)=>clamp(1-Math.abs(v-t)/tol,0,1);

function requiredLandmarks(){return currentExercise.tracking==="upper"?[L.NOSE,L.LS,L.RS,L.LE,L.RE,L.LW,L.RW,L.LH,L.RH]:[L.NOSE,L.LS,L.RS,L.LH,L.RH,L.LK,L.RK,L.LA,L.RA];}
function visibilityScore(lm){const v=requiredLandmarks().map(i=>lm[i]?.visibility??0);return v.reduce((a,b)=>a+b,0)/v.length;}
function acquireThreshold(){return currentExercise.tracking==="upper"?.42:.58;}
function loseThreshold(){return currentExercise.tracking==="upper"?.30:.46;}
function trackingCopy(){return currentExercise.tracking==="upper"?{badge:"👤 上半身辨識｜坐著也可以",placeholder:"只要頭、肩、手臂與腰部入鏡，可以坐著做。",lost:"把頭、肩、雙手和腰部留在畫面裡，不需要拍到腳。"}:{badge:"🧍 全身辨識｜膝蓋與腳踝請入鏡",placeholder:"請往後站，讓頭到腳都能被鏡頭看到。",lost:"往後一點，讓頭、肩、髖、膝和腳踝都在畫面裡。"};}

function applyTTSUI(){ttsToggleBtn.textContent=ttsEnabled?"🔊 語音":"🔇 靜音";ttsToggleBtn.setAttribute("aria-pressed",String(ttsEnabled));ttsVolume.value=String(ttsVol);ttsVolumeWrap.classList.toggle("off",!ttsEnabled);}
function cancelSpeech(){if("speechSynthesis" in window)speechSynthesis.cancel();}
function speak(text,key,{force=false}={}){if(!ttsEnabled||!("speechSynthesis" in window)||!text)return;const now=performance.now();if(!force&&key===lastSpokenKey&&now-lastSpokenAt<4500)return;cancelSpeech();const u=new SpeechSynthesisUtterance(text.replace(/[←→✓✨]/g,""));u.lang="zh-TW";u.rate=.96;u.pitch=1;u.volume=ttsVol;speechSynthesis.speak(u);lastSpokenKey=key;lastSpokenAt=now;}
function announce(main,detail,key,force=true){setCoachText(main,detail);speak(`${main}。${detail}`,key,{force});}

function setScore(score){const s=Math.round(clamp(score,0,100));scoreValue.textContent=s;stageScoreValue.textContent=s;scoreRing.style.background=`conic-gradient(#7aa889 ${s*3.6}deg,#e2e8e3 0deg)`;}
function setCoachText(main,detail){coachMessage.textContent=main;detailMessage.textContent=detail;stageCoachMessage.textContent=main;stageDetailMessage.textContent=detail;}
function syncMetrics(target=1){holdValue.textContent=`${holdSeconds.toFixed(1)}s`;stageHoldValue.textContent=`${holdSeconds.toFixed(1)}s`;repValue.textContent=reps;stageRepValue.textContent=reps;const p=clamp(holdSeconds/Math.max(target,.1),0,1)*100;holdBar.style.width=`${p}%`;stageHoldBar.style.width=`${p}%`;}
function setTrackingState(state){cameraWrap.classList.toggle("tracking-ok",state==="ok");cameraWrap.classList.toggle("tracking-poor",state==="poor");}
function updateRepLabel(){const label=currentExercise.id==="squat"?"完成次數":"完成組數";repLabel.textContent=label;stageRepLabel.textContent=label;}

function personSvg(pose="neutral",badgeText=""){
  const badge=badgeText?`<g transform="translate(62 270)"><rect class="coach-step-badge" x="0" y="0" rx="14" width="116" height="28"/><text class="coach-step-text" x="58" y="19" text-anchor="middle">${badgeText}</text></g>`:"";
  const ground='<line class="coach-ground" x1="32" y1="260" x2="208" y2="260"/>';
  const head='<circle class="avatar-head" cx="120" cy="46" r="24"/><path class="avatar-hair" d="M97 43 Q101 18 120 18 Q143 18 145 45 Q135 31 120 31 Q105 31 97 43Z"/><circle class="avatar-eye" cx="112" cy="46" r="2.5"/><circle class="avatar-eye" cx="128" cy="46" r="2.5"/><path class="avatar-smile" d="M114 56 Q120 61 126 56"/>';
  let torso='<path class="avatar-shirt" d="M93 86 Q120 73 147 86 L153 163 Q120 178 87 163Z"/>';
  let arms='<path class="avatar-skin" d="M92 102 L72 138"/><path class="avatar-skin" d="M148 102 L168 138"/>';
  let legs='<path class="avatar-leg" d="M105 167 L96 248"/><path class="avatar-leg" d="M135 167 L144 248"/><path class="avatar-shoe" d="M88 252 L103 252"/><path class="avatar-shoe" d="M137 252 L153 252"/>';
  let transform=0,motion="";
  if(pose==="left-bend"){transform=-15;arms='<path class="avatar-skin" d="M92 102 L70 132"/><path class="avatar-skin" d="M148 101 L156 62 L160 28"/>';motion='<text class="motion-text" x="20" y="120">往左</text>';}
  if(pose==="right-bend"){transform=15;arms='<path class="avatar-skin" d="M92 101 L84 62 L80 28"/><path class="avatar-skin" d="M148 102 L170 132"/>';motion='<text class="motion-text" x="174" y="120">往右</text>';}
  if(pose==="overhead"){arms='<path class="avatar-skin" d="M92 102 L82 60 L80 25"/><path class="avatar-skin" d="M148 102 L158 60 L160 25"/>';motion='<text class="motion-text" x="92" y="18">向上</text>';}
  if(pose==="seated-left"||pose==="seated-right"){legs='<path class="avatar-leg" d="M106 168 L79 198 L48 198"/><path class="avatar-leg" d="M134 168 L161 198 L192 198"/>';arms='<path class="avatar-skin" d="M92 105 L54 104 L22 98"/><path class="avatar-skin" d="M148 105 L186 104 L218 98"/>';transform=pose==="seated-left"?-12:12;motion=`<text class="motion-text" x="${pose==="seated-left"?24:176}" y="82">${pose==="seated-left"?"左轉":"右轉"}</text>`;}
  if(pose==="tree-left"){legs='<path class="avatar-leg" d="M112 166 L108 248"/><path class="avatar-leg" d="M133 166 L155 192 L116 201"/><path class="avatar-shoe" d="M100 252 L116 252"/>';arms='<path class="avatar-skin" d="M92 102 L76 72 L120 32"/><path class="avatar-skin" d="M148 102 L164 72 L120 32"/>';}
  if(pose==="tree-right"){legs='<path class="avatar-leg" d="M128 166 L132 248"/><path class="avatar-leg" d="M107 166 L85 192 L124 201"/><path class="avatar-shoe" d="M124 252 L140 252"/>';arms='<path class="avatar-skin" d="M92 102 L76 72 L120 32"/><path class="avatar-skin" d="M148 102 L164 72 L120 32"/>';}
  if(pose==="warrior-left"||pose==="warrior-right"){legs=pose==="warrior-left"?'<path class="avatar-leg" d="M107 166 L75 198 L48 248"/><path class="avatar-leg" d="M133 166 L166 184 L207 214"/>':'<path class="avatar-leg" d="M133 166 L165 198 L192 248"/><path class="avatar-leg" d="M107 166 L74 184 L33 214"/>';arms='<path class="avatar-skin" d="M92 103 L54 103 L20 103"/><path class="avatar-skin" d="M148 103 L186 103 L220 103"/>';}
  if(pose==="stand-side"||pose==="squat-side"||pose==="lunge-side-a"||pose==="lunge-side-b"){
    let body="";
    if(pose==="stand-side")body='<circle class="avatar-head" cx="118" cy="47" r="23"/><path class="avatar-shirt" d="M103 82 Q121 75 136 85 L140 159 Q121 169 103 158Z"/><path class="avatar-skin" d="M112 95 L104 137"/><path class="avatar-leg" d="M116 160 L114 244"/><path class="avatar-leg" d="M128 160 L132 244"/><path class="avatar-shoe" d="M104 250 L119 250"/><path class="avatar-shoe" d="M126 250 L143 250"/>';
    else if(pose==="squat-side")body='<circle class="avatar-head" cx="144" cy="68" r="23"/><path class="avatar-shirt" d="M116 98 Q137 91 151 104 L139 166 Q119 168 106 153Z"/><path class="avatar-skin" d="M128 109 L102 142"/><path class="avatar-leg" d="M117 160 L82 190 L65 238"/><path class="avatar-leg" d="M133 161 L164 190 L177 238"/><path class="avatar-shoe" d="M54 244 L73 244"/><path class="avatar-shoe" d="M168 244 L188 244"/>';
    else if(pose==="lunge-side-a")body='<circle class="avatar-head" cx="121" cy="49" r="23"/><path class="avatar-shirt" d="M104 84 Q123 77 139 87 L142 160 Q121 170 103 159Z"/><path class="avatar-skin" d="M113 99 L104 140"/><path class="avatar-leg" d="M113 160 L77 190 L48 240"/><path class="avatar-leg" d="M132 160 L162 194 L207 238"/><path class="avatar-shoe" d="M38 246 L57 246"/><path class="avatar-shoe" d="M199 244 L219 244"/>';
    else body='<circle class="avatar-head" cx="121" cy="49" r="23"/><path class="avatar-shirt" d="M104 84 Q123 77 139 87 L142 160 Q121 170 103 159Z"/><path class="avatar-skin" d="M113 99 L104 140"/><path class="avatar-leg" d="M132 160 L163 190 L192 240"/><path class="avatar-leg" d="M113 160 L83 194 L38 238"/><path class="avatar-shoe" d="M183 246 L202 246"/><path class="avatar-shoe" d="M28 244 L48 244"/>';
    return `<svg viewBox="0 0 240 305" role="img" aria-label="側身動作示範">${ground}${body}${badge}</svg>`;
  }
  return `<svg viewBox="0 0 240 305" role="img" aria-label="動作示範">${ground}${legs}<g transform="rotate(${transform} 120 160)">${head}${torso}${arms}</g>${motion}${badge}</svg>`;
}

const FLOW = {
  "side-stretch": [
    {id:"left",pose:"left-bend",label:"步驟 1 / 4｜左側",main:"← 左側伸展",detail:"右手舉高，身體輕輕往你的左側彎。",hold:3},
    {id:"center1",pose:"neutral",label:"步驟 2 / 4｜回正",main:"回到中間",detail:"身體回正，手放下，停一下。",center:true},
    {id:"right",pose:"right-bend",label:"步驟 3 / 4｜右側",main:"右側伸展 →",detail:"左手舉高，身體輕輕往你的右側彎。",hold:3},
    {id:"center2",pose:"neutral",label:"步驟 4 / 4｜回正",main:"回到中間",detail:"身體回正，手放下，完成 1 組。",center:true}
  ],
  "overhead-stretch": [
    {id:"ready",pose:"neutral",label:"步驟 1 / 3｜準備",main:"先放鬆站好",detail:"雙手自然放下，準備往上伸展。",center:true},
    {id:"up",pose:"overhead",label:"步驟 2 / 3｜向上",main:"雙手向上伸展",detail:"雙手舉過頭頂，手臂拉長，肩膀放鬆。",hold:4},
    {id:"down",pose:"neutral",label:"步驟 3 / 3｜放下",main:"慢慢把手放下",detail:"雙手回到自然位置，回正後完成 1 組。",center:true}
  ],
  "seated-twist": [
    {id:"left",pose:"seated-left",label:"步驟 1 / 4｜左轉",main:"← 向左扭轉",detail:"坐穩，胸口和肩膀慢慢轉向左側。",hold:3},
    {id:"center1",pose:"neutral",label:"步驟 2 / 4｜回正",main:"回到中間",detail:"肩膀回正，停一下。",center:true},
    {id:"right",pose:"seated-right",label:"步驟 3 / 4｜右轉",main:"向右扭轉 →",detail:"坐穩，胸口和肩膀慢慢轉向右側。",hold:3},
    {id:"center2",pose:"neutral",label:"步驟 4 / 4｜回正",main:"回到中間",detail:"肩膀回正，完成 1 組。",center:true}
  ],
  tree: [
    {id:"left",pose:"tree-left",label:"步驟 1 / 4｜第一側",main:"第一側樹式",detail:"抬起一腳，身體保持直立和平衡。",hold:5},
    {id:"center1",pose:"neutral",label:"步驟 2 / 4｜回正",main:"雙腳回到地面",detail:"站穩後準備換另一腳。",center:true},
    {id:"right",pose:"tree-right",label:"步驟 3 / 4｜第二側",main:"換另一腳樹式",detail:"抬起另一腳，身體保持直立和平衡。",hold:5},
    {id:"center2",pose:"neutral",label:"步驟 4 / 4｜回正",main:"雙腳回到地面",detail:"站穩後完成 1 組。",center:true}
  ],
  warrior2: [
    {id:"left",pose:"warrior-left",label:"步驟 1 / 4｜第一側",main:"戰士二式・第一側",detail:"雙手伸平，一側膝蓋彎曲，另一腿伸直。",hold:5},
    {id:"center1",pose:"neutral",label:"步驟 2 / 4｜回正",main:"回到站姿",detail:"雙腿伸直、手放下，準備換邊。",center:true},
    {id:"right",pose:"warrior-right",label:"步驟 3 / 4｜第二側",main:"戰士二式・換邊",detail:"換另一側膝蓋彎曲，雙手維持肩膀高度。",hold:5},
    {id:"center2",pose:"neutral",label:"步驟 4 / 4｜回正",main:"回到站姿",detail:"手放下、雙腿伸直，完成 1 組。",center:true}
  ],
  squat: [
    {id:"ready",pose:"stand-side",label:"步驟 1 / 2｜站姿",main:"側身站好",detail:"雙腳站穩，準備慢慢下蹲。",center:true},
    {id:"down",pose:"squat-side",label:"步驟 2 / 2｜下蹲",main:"慢慢下蹲",detail:"蹲到足夠深後，再完整站回來。",squat:true}
  ],
  lunge: [
    {id:"first",pose:"lunge-side-a",label:"步驟 1 / 4｜第一腳",main:"第一腳向前跨",detail:"側身，一腳向前跨，前後膝蓋彎曲。",hold:3},
    {id:"center1",pose:"stand-side",label:"步驟 2 / 4｜回正",main:"回到站姿",detail:"雙腿站直，準備換另一腳。",center:true},
    {id:"second",pose:"lunge-side-b",label:"步驟 3 / 4｜換腳",main:"換另一腳向前跨",detail:"換腳做弓箭步，保持軀幹直立。",hold:3},
    {id:"center2",pose:"stand-side",label:"步驟 4 / 4｜回正",main:"回到站姿",detail:"雙腿站直，完成 1 組。",center:true}
  ]
};

function flow(){return FLOW[currentExercise.id]||[];}
function currentStep(){const f=flow();return f.find(s=>s.id===phase)||f[0];}
function startPhase(){phase=flow()[0]?.id||"";phaseStable=0;holdSeconds=0;renderVirtualCoach();}
function renderVirtualCoach(){const s=currentStep();virtualCoachFigure.innerHTML=personSvg(s?.pose||"neutral",s?.label?.replace(/｜.*/,"")||"");virtualCoachLabel.textContent=s?.label||"跟著示範人物慢慢做";}
function applyTrackingUI(){const c=trackingCopy();trackingRequirement.textContent=c.badge;placeholderHint.textContent=c.placeholder;}
function goToPhase(id,messageOverride=null){phase=id;phaseStable=0;holdSeconds=0;renderVirtualCoach();const s=currentStep();announce(messageOverride||s.main,s.detail,`${currentExercise.id}-${id}-${reps}`,true);}
function completeSet(){reps++;const first=flow()[0];phase=first.id;phaseStable=0;holdSeconds=0;renderVirtualCoach();announce(`✨ 完成 ${reps} 組！`, `下一組：${first.detail}`,`${currentExercise.id}-done-${reps}`,true);}
function nextPhase(){const f=flow(),i=f.findIndex(s=>s.id===phase);if(i<0)return;if(i===f.length-1)completeSet();else goToPhase(f[i+1].id);}

function neutralPose(lm){const ls=j(lm,L.LS),rs=j(lm,L.RS),lw=j(lm,L.LW),rw=j(lm,L.RW),lh=j(lm,L.LH),rh=j(lm,L.RH),lk=j(lm,L.LK),rk=j(lm,L.RK),la=j(lm,L.LA),ra=j(lm,L.RA);const armsDown=(lw.y>ls.y-.02||rw.y>rs.y-.02);const torso=Math.abs(((ls.x+rs.x)/2)-((lh.x+rh.x)/2))<.07;if(currentExercise.tracking==="upper")return armsDown&&torso;const knees=(angle(lh,lk,la)+angle(rh,rk,ra))/2;return torso&&knees>150;}
function sideBendMetrics(lm){const ls=j(lm,L.LS),rs=j(lm,L.RS),le=j(lm,L.LE),re=j(lm,L.RE),lw=j(lm,L.LW),rw=j(lm,L.RW),lh=j(lm,L.LH),rh=j(lm,L.RH);const dx=((ls.x+rs.x)/2)-((lh.x+rh.x)/2);return{dx,leftRaised:(ls.y-lw.y)>.04&&angle(ls,le,lw)>115,rightRaised:(rs.y-rw.y)>.04&&angle(rs,re,rw)>115};}
function overheadGood(lm){const ls=j(lm,L.LS),rs=j(lm,L.RS),le=j(lm,L.LE),re=j(lm,L.RE),lw=j(lm,L.LW),rw=j(lm,L.RW);return ((ls.y-lw.y)+(rs.y-rw.y))/2>.07&&angle(ls,le,lw)>125&&angle(rs,re,rw)>125;}
function twistMetric(lm){const ls=j(lm,L.LS),rs=j(lm,L.RS),lh=j(lm,L.LH),rh=j(lm,L.RH);return ((ls.x+rs.x)/2)-((lh.x+rh.x)/2);}
function treeGood(lm){const lh=j(lm,L.LH),rh=j(lm,L.RH),lk=j(lm,L.LK),rk=j(lm,L.RK),la=j(lm,L.LA),ra=j(lm,L.RA),ls=j(lm,L.LS),rs=j(lm,L.RS);const bent=Math.min(angle(lh,lk,la),angle(rh,rk,ra));const ankleLift=Math.abs(la.y-ra.y);const stable=Math.abs(ls.y-rs.y)<.09;return bent<145&&ankleLift>.07&&stable;}
function warriorGood(lm){const ls=j(lm,L.LS),rs=j(lm,L.RS),lw=j(lm,L.LW),rw=j(lm,L.RW),lh=j(lm,L.LH),rh=j(lm,L.RH),lk=j(lm,L.LK),rk=j(lm,L.RK),la=j(lm,L.LA),ra=j(lm,L.RA);const arms=Math.abs(lw.y-ls.y)<.13&&Math.abs(rw.y-rs.y)<.13;const knees=[angle(lh,lk,la),angle(rh,rk,ra)];return arms&&Math.min(...knees)<140&&Math.max(...knees)>145;}
function lungeGood(lm){const lh=j(lm,L.LH),rh=j(lm,L.RH),lk=j(lm,L.LK),rk=j(lm,L.RK),la=j(lm,L.LA),ra=j(lm,L.RA);const a=angle(lh,lk,la),b=angle(rh,rk,ra);return Math.min(a,b)<135&&Math.max(a,b)>120;}

function evaluateStep(lm,dt){
  const s=currentStep();if(!s)return{score:0,message:"準備開始",detail:""};
  let good=false,score=0;
  if(currentExercise.id==="side-stretch"&&(s.id==="left"||s.id==="right")){const m=sideBendMetrics(lm);good=s.id==="left"?(m.rightRaised&&m.dx>.004):(m.leftRaised&&m.dx<-.004);score=good?90:55;}
  else if(currentExercise.id==="overhead-stretch"&&s.id==="up"){good=overheadGood(lm);score=good?92:50;}
  else if(currentExercise.id==="seated-twist"&&(s.id==="left"||s.id==="right")){const t=twistMetric(lm);good=s.id==="left"?t>.012:t<-.012;score=good?88:52;}
  else if(currentExercise.id==="tree"&&(s.id==="left"||s.id==="right")){good=treeGood(lm);score=good?90:48;}
  else if(currentExercise.id==="warrior2"&&(s.id==="left"||s.id==="right")){good=warriorGood(lm);score=good?90:50;}
  else if(currentExercise.id==="lunge"&&(s.id==="first"||s.id==="second")){good=lungeGood(lm);score=good?90:50;}
  else if(currentExercise.id==="squat"&&s.id==="down"){
    const lh=j(lm,L.LH),rh=j(lm,L.RH),lk=j(lm,L.LK),rk=j(lm,L.RK),la=j(lm,L.LA),ra=j(lm,L.RA);const avg=(angle(lh,lk,la)+angle(rh,rk,ra))/2;
    if(avg<125){phaseStable+=dt;score=95;}else{phaseStable=Math.max(0,phaseStable-dt*.4);score=clamp((170-avg)/45*100,0,85);}
    if(phaseStable>.35){goToPhase("ready","蹲到了！請慢慢站回來");phase="ready-return";}
    return{score,message:avg<140?"蹲到了，準備站回來":"慢慢下蹲",detail:"側身比較容易看清膝蓋角度。"};
  } else if(currentExercise.id==="squat"&&phase==="ready-return"){
    good=neutralPose(lm);score=good?100:55;if(good)phaseStable+=dt;else phaseStable=0;if(phaseStable>.45){reps++;phase="ready";phaseStable=0;renderVirtualCoach();announce(`完成第 ${reps} 次`,`站好了，準備下一次深蹲。`,`squat-rep-${reps}`,true);}return{score,message:"請站回直立",detail:"完整站直後才計 1 次。"};
  }
  else if(s.center){good=neutralPose(lm);score=good?100:55;}

  const target=s.hold||0;
  if(target){holdSeconds=good?holdSeconds+dt:Math.max(0,holdSeconds-dt*.25);if(holdSeconds>=target){nextPhase();return{score:100,message:"✓ 完成這一步",detail:currentStep()?.detail||""};}}
  else if(s.center){phaseStable=good?phaseStable+dt:Math.max(0,phaseStable-dt*.25);if(phaseStable>=.5){nextPhase();return{score:100,message:"✓ 已回正",detail:currentStep()?.detail||""};}}
  return{score,message:s.main,detail:good&&target?`很好，維持 ${Math.max(0,target-holdSeconds).toFixed(1)} 秒`:s.detail};
}

function renderExerciseList(){const mode=MODES[currentMode];modeTitle.textContent=mode.title;exerciseCount.textContent=mode.exercises.length;exerciseList.innerHTML="";mode.exercises.forEach(ex=>{const b=document.createElement("button");b.type="button";b.className=`exercise-btn${ex.id===currentExercise.id?" active":""}`;b.innerHTML=`<strong>${ex.name}</strong><small>${ex.subtitle}</small>`;b.addEventListener("click",()=>selectExercise(ex));exerciseList.appendChild(b);});}
function resetExerciseState(){reps=0;holdSeconds=0;phaseStable=0;trackingAcquired=false;trackingReady=false;lowVisibilityFrames=0;updateRepLabel();startPhase();syncMetrics(currentStep()?.hold||1);setScore(0);}
function selectExercise(ex){currentExercise=ex;exerciseName.textContent=ex.name;exerciseInstruction.textContent=ex.instruction;stageExerciseName.textContent=ex.name;stageInstruction.textContent=ex.instruction;resetExerciseState();applyTrackingUI();setCoachText(running?"準備好後開始動作":"按下「開始運動」",running?trackingCopy().lost:"開始後會完整帶你做完每一個步驟。");renderExerciseList();}

async function createPoseLandmarker(){if(poseLandmarker)return poseLandmarker;cameraState.textContent="載入姿勢模型…";stageCoachMessage.textContent="正在載入動作辨識…";const vision=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");poseLandmarker=await PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",delegate:"GPU"},runningMode:"VIDEO",numPoses:1,minPoseDetectionConfidence:.42,minPosePresenceConfidence:.42,minTrackingConfidence:.42,outputSegmentationMasks:true});return poseLandmarker;}
function enterWorkoutUI(){document.body.classList.add("workout-active");exitWorkoutBtn.hidden=false;stageExerciseName.textContent=currentExercise.name;stageInstruction.textContent=currentExercise.instruction;applyTrackingUI();renderVirtualCoach();}
async function requestWorkoutFullscreen(){enterWorkoutUI();if(!document.fullscreenElement&&document.documentElement.requestFullscreen){try{await document.documentElement.requestFullscreen();}catch(_){}}}
async function startCamera(){requestWorkoutFullscreen();setTrackingState("none");trackingAcquired=false;trackingReady=false;announce("正在開啟鏡頭…",trackingCopy().lost,"camera-start",true);try{await createPoseLandmarker();stream?.getTracks().forEach(t=>t.stop());stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:1280},height:{ideal:720}},audio:false});video.srcObject=stream;await video.play();running=true;cameraPlaceholder.classList.add("hidden");cameraState.textContent=currentExercise.tracking==="upper"?"尋找上半身…":"尋找全身…";startCameraBtn.textContent="重新啟動鏡頭";syncMirror();lastFrameTimestamp=performance.now();requestAnimationFrame(predictLoop);}catch(e){console.error(e);cameraState.textContent="無法啟動鏡頭";announce("鏡頭或姿勢模型啟動失敗","請確認已允許攝影機權限，並使用 HTTPS 開啟。","camera-error",true);}}
function syncCanvasSize(){const w=video.videoWidth||1280,h=video.videoHeight||720;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}}

function ensureGlowBuffers(w,h){if(maskCanvas.width===w&&maskCanvas.height===h&&smoothedMask)return;maskCanvas.width=edgeCanvas.width=w;maskCanvas.height=edgeCanvas.height=h;maskImageData=maskCtx.createImageData(w,h);edgeImageData=edgeCtx.createImageData(w,h);smoothedMask=new Float32Array(w*h);}
function clearGlow(){ctx.clearRect(0,0,canvas.width,canvas.height);}
function drawBodyGlow(result){
  clearGlow();if(!trackingReady||!result?.landmarks?.length)return;const mask=result.segmentationMasks?.[0];if(!mask)return;
  try{
    const w=mask.width,h=mask.height,vals=mask.getAsFloat32Array();ensureGlowBuffers(w,h);
    for(let i=0;i<vals.length;i++)smoothedMask[i]=smoothedMask[i]*.68+vals[i]*.32;
    const edge=edgeImageData.data;edge.fill(0);const th=.48,r=4;
    for(let y=r;y<h-r;y++)for(let x=r;x<w-r;x++){
      const idx=y*w+x;if(smoothedMask[idx]<th)continue;let boundary=false;
      for(let oy=-r;oy<=r&&!boundary;oy+=2)for(let ox=-r;ox<=r;ox+=2){if(!ox&&!oy)continue;if(smoothedMask[(y+oy)*w+x+ox]<th-.06){boundary=true;break;}}
      if(!boundary)continue;const p=idx*4;edge[p]=255;edge[p+1]=220;edge[p+2]=55;edge[p+3]=255;
    }
    edgeCtx.putImageData(edgeImageData,0,0);
    ctx.save();ctx.globalCompositeOperation="source-over";
    ctx.globalAlpha=.85;ctx.filter="blur(11px)";ctx.drawImage(edgeCanvas,0,0,canvas.width,canvas.height);
    ctx.globalAlpha=1;ctx.filter="blur(3px)";ctx.drawImage(edgeCanvas,0,0,canvas.width,canvas.height);
    ctx.globalAlpha=.95;ctx.filter="none";ctx.drawImage(edgeCanvas,0,0,canvas.width,canvas.height);
    ctx.restore();
  }catch(_){clearGlow();}
}

function updateCoach(lm,dt){
  const visible=visibilityScore(lm),pct=Math.round(visible*100);visibilityValue.textContent=`${pct}%`;
  if(!trackingReady){if(visible>=acquireThreshold()){trackingReady=true;lowVisibilityFrames=0;}else{setTrackingState("poor");cameraState.textContent=`入鏡 ${pct}%`;setScore(0);setCoachText(currentExercise.tracking==="upper"?"請把上半身留在畫面裡":"請讓全身完整進入畫面",trackingCopy().lost);syncMetrics(currentStep()?.hold||1);return;}}
  if(visible<loseThreshold())lowVisibilityFrames++;else lowVisibilityFrames=0;
  if(lowVisibilityFrames>10){trackingReady=false;trackingAcquired=false;setTrackingState("poor");cameraState.textContent=`入鏡 ${pct}%`;clearGlow();return;}
  setTrackingState("ok");cameraState.textContent="✓ 已辨識，可以開始";
  if(!trackingAcquired){trackingAcquired=true;const s=currentStep();announce(s.main,s.detail,`tracking-${currentExercise.id}-${phase}`,true);}
  const ev=evaluateStep(lm,dt);setScore(ev.score);setCoachText(ev.message,ev.detail);syncMetrics(currentStep()?.hold||1);
}
function predictLoop(){if(!running||!poseLandmarker||video.readyState<2)return;syncCanvasSize();const now=performance.now(),dt=Math.min((now-lastFrameTimestamp)/1000,.1);lastFrameTimestamp=now;if(video.currentTime!==lastVideoTime){lastVideoTime=video.currentTime;const result=poseLandmarker.detectForVideo(video,now);if(result.landmarks?.length)updateCoach(result.landmarks[0],dt);else{lowVisibilityFrames++;if(lowVisibilityFrames>10){trackingReady=false;trackingAcquired=false;setTrackingState("none");clearGlow();}visibilityValue.textContent="--";cameraState.textContent=currentExercise.tracking==="upper"?"尋找上半身…":"尋找人體…";}drawBodyGlow(result);}requestAnimationFrame(predictLoop);}
function syncMirror(){video.classList.toggle("mirrored",mirrored);canvas.classList.toggle("mirrored",mirrored);mirrorBtn.textContent=`鏡像：${mirrored?"開":"關"}`;}
async function exitWorkout(){document.body.classList.remove("workout-active");exitWorkoutBtn.hidden=true;cancelSpeech();if(document.fullscreenElement&&document.exitFullscreen){try{await document.exitFullscreen();}catch(_){}}}
function resetSession(){resetExerciseState();setTrackingState("none");clearGlow();setCoachText("已重新校正",trackingCopy().lost);speak("已重新校正，請回到畫面中央","reset",{force:true});}

document.querySelectorAll(".mode-card").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".mode-card").forEach(i=>i.classList.remove("active"));b.classList.add("active");currentMode=b.dataset.mode;selectExercise(MODES[currentMode].exercises[0]);}));
mirrorBtn.addEventListener("click",()=>{mirrored=!mirrored;syncMirror();});startCameraBtn.addEventListener("click",startCamera);resetBtn.addEventListener("click",resetSession);exitWorkoutBtn.addEventListener("click",exitWorkout);
ttsToggleBtn.addEventListener("click",()=>{ttsEnabled=!ttsEnabled;localStorage.setItem("yf_tts",ttsEnabled?"on":"off");applyTTSUI();if(!ttsEnabled)cancelSpeech();else speak("語音提示已開啟","tts-on",{force:true});});
ttsVolume.addEventListener("input",()=>{ttsVol=Number(ttsVolume.value);localStorage.setItem("yf_tts_volume",String(ttsVol));applyTTSUI();});
document.addEventListener("fullscreenchange",()=>{if(!document.fullscreenElement&&document.body.classList.contains("workout-active")&&!running)document.body.classList.remove("workout-active");});

applyTTSUI();syncMirror();renderExerciseList();selectExercise(currentExercise);
