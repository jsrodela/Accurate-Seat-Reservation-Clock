// ===== 상태 =====
let targetUrl = localStorage.getItem('reserve_target_url')
  || "https://myrussel.megastudy.net/reserve/reserve_list.asp";

const samples = [];
const MAX_SAMPLES = 240; // ~4분 @1Hz
let bestRTT = Number.POSITIVE_INFINITY;
let bestOffset = 0;

const cfg = {
  prefire_ms: 120,
  use_best_half_rtt: true,
  target_mode: "local", // 'local' | 'server'
  target_iso: ""
};

// ===== 유틸 =====
const $ = id => document.getElementById(id);
function nowMs(){ return performance.timeOrigin + performance.now(); }
function fmtTime(ms){
  if (ms == null) return "--:--:--.---";
  const d = new Date(ms);
  const pad2 = n => String(n).padStart(2,'0');
  const ms3 = String(d.getMilliseconds()).padStart(3,'0');
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${ms3}`;
}
function fmtDur(ms){
  if (ms == null) return "—";
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const s = Math.floor(abs / 1000);
  const m = Math.floor(s / 60);
  const rems = s % 60;
  const ms3 = String(Math.floor(abs % 1000)).padStart(3,'0');
  return `${sign}${String(m).padStart(2,'0')}:${String(rems).padStart(2,'0')}.${ms3}`;
}
function median(a){ if(!a.length) return 0; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function pstdev(a){ if(a.length<=1) return 0; const mean=a.reduce((p,c)=>p+c,0)/a.length; const v=a.reduce((p,c)=>p+(c-mean)*(c-mean),0)/a.length; return Math.sqrt(v); }

// ✅ URL sanitize (제로폭 공백 제거 + 스킴 보정 + 백슬래시 정규화)
function sanitizeUrl(raw) {
  if (!raw) return "";
  const INVIS = /[\u200B-\u200D\uFEFF\u2060]/g;
  let s = raw.replace(INVIS, "").trim();
  s = s.replace(/\s+/g, "");
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = "https://" + s;
  s = s.replace(/\\/g, "/");
  return s;
}

// ===== datetime-local 헬퍼 =====
function getDTMs(el){
  const v = el.valueAsNumber;
  return Number.isFinite(v) ? v : NaN;
}
function setDTMs(el, ms){
  if(!Number.isFinite(ms)) return;
  const d = new Date(ms);
  const pad2 = n => String(n).padStart(2,'0');
  const val = `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  el.value = val;
}

// Flexible 텍스트 파서 (로컬 기준)
function parseFlexibleLocal(str){
  if(!str) return NaN;
  let s = str.trim().replace(/\s+/g,' ');
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if(m){
    const [_,Y,M,D,h,mi,se] = m;
    return new Date(Number(Y), Number(M)-1, Number(D), Number(h), Number(mi), Number(se||0), 0).getTime();
  }
  m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(m){
    const now = new Date();
    const [_,h,mi,se] = m;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(h), Number(mi), Number(se||0), 0).getTime();
  }
  m = s.match(/^(\d{1,2})(\d{2})(\d{2})$/);
  if(m){
    const now = new Date();
    const [_,h,mi,se] = m;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(h), Number(mi), Number(se)).getTime();
  }
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? NaN : t;
}

// ===== 네트워킹(HEAD 샘플) =====
async function headOnce(url){
  const t0 = performance.now();
  const r = await fetch(url, { method:'HEAD', cache:'no-store' });
  const t3 = performance.now();

  const date = r.headers.get('date');
  const rtt = t3 - t0;
  if (!date) return { ok:false, rtt, dateHdr:"" };

  const serverEpoch = new Date(date).getTime();
  const midLocal = performance.timeOrigin + (t0 + t3)/2;
  const offset = serverEpoch - midLocal; // server - local
  return { ok:true, rtt, offset, dateHdr:date, serverEpoch };
}

async function sampleTick(){
  try {
    const s = await headOnce(targetUrl);
    if (s.ok) {
      if (samples.length >= MAX_SAMPLES) samples.shift();
      samples.push(s);
      if (s.rtt < bestRTT) { bestRTT = s.rtt; bestOffset = s.offset; }
    }
  } catch {}
}

// ===== 통계/클릭 시각 =====
function getStats(){
  const ok = samples;
  if (!ok.length) {
    return { have:false, nowLocal:nowMs(), nowServer:null, offset:null, offsetMedian:null, offsetStdev:null, rttMean:null, rttStdev:null, bestRTT:null, lastDate:"", count:0 };
  }
  const offsets = ok.filter(s=>s.ok).map(s=>s.offset);
  const rtts    = ok.filter(s=>s.ok).map(s=>s.rtt);
  const last    = ok[ok.length-1];

  const nowLocal = nowMs();
  const offsetBest = bestOffset;
  const nowServer = nowLocal + offsetBest;
  const rttMean = rtts.reduce((a,b)=>a+b,0)/rtts.length;

  return {
    have:true,
    nowLocal, nowServer,
    offset: offsetBest,
    offsetMedian: median(offsets),
    offsetStdev: pstdev(offsets),
    rttMean, rttStdev: pstdev(rtts),
    bestRTT, lastDate: last.dateHdr || "",
    count: ok.length
  };
}

function parseTargetToServerMs(targetStr, mode, offset){
  if (!targetStr) return null;
  let s = targetStr.trim().replace("T"," ");
  if (s.length === 16) s += ":00";
  const dt = new Date(s);  // 로컬 타임존 해석
  const localMs = dt.getTime();
  if (Number.isNaN(localMs)) return null;
  return (mode === 'local') ? (localMs + offset) : localMs;
}

function computeClickMs(st, cfg){
  if (!st.have || st.offset==null || !cfg.target_iso) return { clickMs:null, eta:null };
  const targetServer = parseTargetToServerMs(cfg.target_iso, cfg.target_mode, st.offset);
  if (targetServer==null) return { clickMs:null, eta:null };
  const travel = (cfg.use_best_half_rtt && st.bestRTT) ? st.bestRTT/2 : 0;
  const clickLocal = targetServer - st.offset - cfg.prefire_ms - travel;
  return { clickMs: clickLocal, eta: clickLocal - st.nowLocal };
}

// ===== 렌더 =====
function render(){
  const st = getStats();

  $('local').textContent  = fmtTime(st.nowLocal);
  $('server').textContent = st.nowServer ? fmtTime(st.nowServer) : "--:--:--.---";
  $('offset').textContent = (st.offset!=null) ? `${Math.round(st.offset)} ms` : "-- ms";
  $('rtt').textContent    = (st.rttMean!=null && st.bestRTT!=null) ? `${Math.round(st.rttMean)} / ${Math.round(st.bestRTT)} ms` : "-- / -- ms";
  $('offstd').textContent = (st.offsetStdev!=null) ? `${Math.round(st.offsetStdev)} ms` : "-- ms";
  $('rttstd').textContent = (st.rttStdev!=null) ? `${Math.round(st.rttStdev)} ms` : "-- ms";
  $('count').textContent  = st.count;
  $('datehdr').textContent= st.lastDate || "—";
  $('samplestat').textContent = st.count ? `samples: ${st.count}` : 'sampling…';

  const { clickMs, eta } = computeClickMs(st, cfg);
  $('clicktime').textContent = clickMs ? fmtTime(clickMs) : "—";
  $('countdown').textContent = (eta!=null) ? fmtDur(eta) : "—";
  $('countdown').className = "countdown " + (eta==null ? "" : (eta<=0 ? "green blink" : (eta<1500 ? "warn" : "")));
}

// ===== 바인딩 =====
function bind(){
  // URL
  const urlInput = $('url');
  const setBtn = $('seturl');
  urlInput.value = targetUrl;
  $('currenturl').textContent = targetUrl;
  function applyUrl() {
    const raw = urlInput.value;
    const s = sanitizeUrl(raw);
    if (!s) return;
    try {
      const parsed = new URL(s);
      if (!/^https?:$/i.test(parsed.protocol)) throw new Error('scheme');
      targetUrl = parsed.toString();
      localStorage.setItem('reserve_target_url', targetUrl);
      $('currenturl').textContent = targetUrl;
      samples.length = 0; bestRTT = Number.POSITIVE_INFINITY; bestOffset = 0;
      render();
    } catch {
      alert('유효한 URL을 입력하세요 (http/https).');
    }
  }
  setBtn.onclick = applyUrl;
  urlInput.addEventListener('keypress', (ev) => { if (ev.key === 'Enter') applyUrl(); });

  // === 예약 타깃 ===
  const dtEl  = $('target_dt');
  const txtEl = $('target_text');
  const modeEl= $('mode');

  // 초기값: 다음 분 정각
  const now = new Date();
  const nextMin = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()+1, 0, 0).getTime();
  setDTMs(dtEl, nextMin);
  txtEl.value = "";
  $('tzlabel').textContent = `Local TZ: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;

  // 프리셋 버튼
  document.querySelectorAll('.preset').forEach(btn=>{
    btn.onclick = ()=>{
      const key = btn.getAttribute('data-ms');
      const base = Date.now();
      if (key === 'now') setDTMs(dtEl, base);
      else setDTMs(dtEl, base + Number(key));
    };
  });
  $('roundMin').onclick = ()=>{
    const n = Date.now();
    const nm = Math.ceil((n+1) / 60000) * 60000;
    setDTMs(dtEl, nm);
  };

  // 저장
  $('save').onclick = () => {
    let targetMs = getDTMs(dtEl);
    if (Number.isNaN(targetMs) && txtEl.value.trim()){
      targetMs = parseFlexibleLocal(txtEl.value);
    }
    if (Number.isNaN(targetMs)){
      alert('타깃 시각을 선택하거나 올바른 형식으로 입력하세요.');
      return;
    }
    const d = new Date(targetMs);
    const pad2 = n => String(n).padStart(2,'0');
    cfg.target_mode = modeEl.value;
    cfg.target_iso  = `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    cfg.prefire_ms  = parseInt(($('prefire').value || '120'), 10);
    cfg.use_best_half_rtt = $('halfrtt').checked;

    render();
  };
}

// ===== 시작 =====
function start(){
  bind();
  render();
  setInterval(async () => { await sampleTick(); render(); }, 1000); // 1Hz 샘플링
  const raf = () => { render(); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
}
start();
