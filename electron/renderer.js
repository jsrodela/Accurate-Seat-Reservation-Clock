// ===== 기본 상태 =====
let targetUrl = localStorage.getItem('reserve_target_url')
  || "https://myrussel.megastudy.net/reserve/reserve_list.asp";

const samples = [];
const MAX_SAMPLES = 240;        // ~4분 @1Hz
let bestRTT = Number.POSITIVE_INFINITY;
let bestOffset = 0;

const cfg = {
  prefire_ms: 120,
  use_best_half_rtt: true,
  target_mode: "local", // 'local' | 'server'
  target_iso: ""
};

// ===== 유틸 =====
const $ = (id) => document.getElementById(id);
function nowMs(){ return performance.timeOrigin + performance.now(); }
function fmtTime(ms){
  if (ms == null) return "--:--:--.---";
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  const ms3 = String(d.getMilliseconds()).padStart(3,'0');
  return `${hh}:${mm}:${ss}.${ms3}`;
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

// ✅ URL 정리 (보이지 않는 공백 제거 + 스킴 자동 보정)
function sanitizeUrl(raw) {
  if (!raw) return "";
  const INVIS = /[\u200B-\u200D\uFEFF\u2060]/g; // zero-width 등
  let s = raw.replace(INVIS, "").trim();
  s = s.replace(/\s+/g, "");
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = "https://" + s; // 스킴 없으면 https
  s = s.replace(/\\/g, "/");
  return s;
}

// ===== 네트워킹(HEAD 샘플) =====
async function headOnce(url){
  const t0 = performance.now();
  const r = await fetch(url, { method:'HEAD', cache:'no-store' });
  const t3 = performance.now();

  const date = r.headers.get('date');
  const rtt = t3 - t0;
  if (!date) return { ok:false, rtt, dateHdr:"" };

  const serverEpoch = new Date(date).getTime(); // ms
  const midLocal = performance.timeOrigin + (t0 + t3)/2;
  const offset = serverEpoch - midLocal;        // server - local
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

// ===== 통계/클릭시각 =====
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
  const dt = new Date(s); // 로컬 타임존 해석
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
  // URL 설정
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

      // 샘플/베스트 리셋
      samples.length = 0; bestRTT = Number.POSITIVE_INFINITY; bestOffset = 0;
      render();
    } catch {
      alert('유효한 URL을 입력하세요 (http/https).');
    }
  }
  setBtn.onclick = applyUrl;
  urlInput.addEventListener('keypress', (ev) => { if (ev.key === 'Enter') applyUrl(); });

  // 예약 타깃 설정
  $('save').onclick = () => {
    cfg.target_mode = $('mode').value;
    cfg.target_iso  = $('target').value;
    cfg.prefire_ms  = parseInt(($('prefire').value || '120'), 10);
    cfg.use_best_half_rtt = $('halfrtt').checked;
    render();
  };
}

// ===== 시작 =====
function start(){
  bind();
  render();
  setInterval(async () => { await sampleTick(); render(); }, 1000); // 1Hz
  const raf = () => { render(); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
}
start();
