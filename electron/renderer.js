// ====== Config ======
let targetUrl = localStorage.getItem('reserve_target_url')
  || "https://myrussel.megastudy.net/reserve/reserve_list.asp"; // 기본값

// ====== State ======
const samples = [];
const MAX_SAMPLES = 240;
let bestRTT = Number.POSITIVE_INFINITY;
let bestOffset = 0;
let timer = null;

// User config (UI)
const cfg = {
  prefire_ms: 120,
  use_best_half_rtt: true,
  target_mode: "local", // 'local' | 'server'
  target_iso: ""        // "YYYY-MM-DD HH:MM:SS"
};

// ====== Utils ======
function nowMs() {
  return performance.timeOrigin + performance.now();
}
function fmtTime(ms) {
  if (ms == null) return "--:--:--.---";
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  const ms3 = String(d.getMilliseconds()).padStart(3,'0');
  return `${hh}:${mm}:${ss}.${ms3}`;
}
function fmtDur(ms) {
  if (ms == null) return "—";
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const s = Math.floor(abs / 1000);
  const m = Math.floor(s / 60);
  const rems = s % 60;
  const ms3 = String(Math.floor(abs % 1000)).padStart(3,'0');
  return `${sign}${String(m).padStart(2,'0')}:${String(rems).padStart(2,'0')}.${ms3}`;
}
function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x,y)=>x-y);
  const m = Math.floor(a.length/2);
  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
}
function pstdev(arr) {
  if (arr.length <= 1) return 0;
  const mean = arr.reduce((s,x)=>s+x,0)/arr.length;
  const varp = arr.reduce((s,x)=>s+(x-mean)*(x-mean),0)/arr.length;
  return Math.sqrt(varp);
}

// ====== Sampling (targetUrl 사용하도록 변경) ======
async function headOnce(url){
  const t0 = performance.now();
  const r = await fetch(url, {
    method: 'HEAD',
    cache: 'no-store',
    headers: { 'User-Agent': 'ReserveClock/0.2 (Electron)' }
  });
  const t3 = performance.now();
  const date = r.headers.get('date');
  const rtt = t3 - t0;
  if (!date) return { ok:false, rtt, dateHdr:"" };

  const serverEpoch = new Date(date).getTime();
  const midLocal = performance.timeOrigin + (t0 + t3)/2;
  const offset = serverEpoch - midLocal;
  return { ok:true, rtt, offset, dateHdr:date, serverEpoch };
}

async function sampleTick(){
  try{
    const s = await headOnce(targetUrl);   // ← 여기
    if (s.ok) {
      if (samples.length >= MAX_SAMPLES) samples.shift();
      samples.push(s);
      if (s.rtt < bestRTT) { bestRTT = s.rtt; bestOffset = s.offset; }
    }
    render();
  } catch (e) {
    // 네트워크 실패 시 무시하고 다음 틱
  }
}

// ====== Stats & Click Time ======
function getStats(){
  const ok = samples;
  if (!ok.length) {
    return {
      have: false,
      nowLocal: nowMs(),
      nowServer: null,
      offset: null,
      offsetMedian: null,
      offsetStdev: null,
      rttMean: null,
      rttStdev: null,
      bestRTT: null,
      lastDate: "",
      count: 0
    };
  }
  const offsets = ok.filter(s=>s.ok).map(s=>s.offset);
  const rtts    = ok.filter(s=>s.ok).map(s=>s.rtt);
  const last    = ok[ok.length-1];

  // estimates
  const offsetBest = bestOffset;
  const nowLocal = nowMs();
  const nowServer = nowLocal + offsetBest;

  // stats
  const rttMean = rtts.reduce((a,b)=>a+b,0)/rtts.length;
  return {
    have: true,
    nowLocal,
    nowServer,
    offset: offsetBest,
    offsetMedian: median(offsets),
    offsetStdev: pstdev(offsets),
    rttMean,
    rttStdev: pstdev(rtts),
    bestRTT: bestRTT,
    lastDate: last.dateHdr || "",
    count: ok.length
  };
}

function parseTargetToServerMs(targetStr, mode, offset){
  if (!targetStr) return null;
  // 입력: "YYYY-MM-DD HH:MM:SS" (로컬 기준 가정)
  let s = targetStr.trim().replace("T"," ");
  if (s.length === 16) s += ":00";
  const dt = new Date(s); // 로컬 시간대 해석
  const localMs = dt.getTime();
  if (Number.isNaN(localMs)) return null;

  if (mode === 'local') return localMs + offset; // local → server
  return localMs;                                 // server 그대로
}

function computeClickMs(stats, cfg){
  if (!stats.have || stats.offset == null || !cfg.target_iso) return { clickMs:null, eta:null };
  const targetServer = parseTargetToServerMs(cfg.target_iso, cfg.target_mode, stats.offset);
  if (targetServer == null) return { clickMs:null, eta:null };

  const travel = (cfg.use_best_half_rtt && stats.bestRTT) ? stats.bestRTT/2 : 0;
  const clickLocal = targetServer - stats.offset - cfg.prefire_ms - travel;
  const eta = clickLocal - stats.nowLocal;
  return { clickMs: clickLocal, eta };
}

// ====== UI 바인딩 (추가됨) ======
function bind(){
  // 기존 예약 타깃 저장 버튼
  document.getElementById('save').onclick = () => {
    cfg.target_mode = document.getElementById('mode').value;
    cfg.target_iso  = document.getElementById('target').value;
    cfg.prefire_ms  = parseInt(document.getElementById('prefire').value || '120', 10);
    cfg.use_best_half_rtt = document.getElementById('halfrtt').checked;
    render();
  };

  // ★ 새로 추가: URL 설정
  const urlInput = document.getElementById('url');
  const setBtn   = document.getElementById('seturl');

  // 초기 표시
  urlInput.value = targetUrl;
  document.getElementById('currenturl').textContent = targetUrl;

  function applyUrl() {
    const u = urlInput.value.trim();
    if (!u) return;
    try {
      // 기본 검증: 프로토콜 포함 여부
      const parsed = new URL(u);
      if (!/^https?:$/i.test(parsed.protocol)) throw new Error('http/https만 지원');
      targetUrl = parsed.toString();

      // 상태 초기화
      samples.length = 0;
      bestRTT = Number.POSITIVE_INFINITY;
      bestOffset = 0;

      // 저장 및 표시
      localStorage.setItem('reserve_target_url', targetUrl);
      document.getElementById('currenturl').textContent = targetUrl;
      render();
    } catch (e) {
      alert('유효한 URL을 입력하세요 (http/https).');
    }
  }

  setBtn.onclick = applyUrl;
  urlInput.addEventListener('keypress', (ev) => {
    if (ev.key === 'Enter') applyUrl();
  });
}

// ====== Start ======
function start(){
  bind();
  render();
  // 1 Hz 샘플링
  timer = setInterval(sampleTick, 1000);
  // 화면 부드럽게 갱신
  function rafLoop(){ render(); requestAnimationFrame(rafLoop); }
  requestAnimationFrame(rafLoop);
}
start();
