// ====== Config ======
const TARGET_URL = "https://myrussel.megastudy.net/reserve/reserve_list.asp";

// ====== State ======
const samples = [];             // keep recent samples
const MAX_SAMPLES = 240;        // ~4 minutes at 1 Hz
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

// ====== Sampling ======
async function headOnce(url){
  const t0 = performance.now();
  const r = await fetch(url, {
    method: 'HEAD',
    cache: 'no-store',
    // 일부 서버가 UA 없으면 차단할 수 있어 헤더 추가(선택)
    headers: { 'User-Agent': 'ReserveClock/0.2 (Electron)' }
  });
  const t3 = performance.now();
  const date = r.headers.get('date');
  const rtt = t3 - t0;
  if (!date) return { ok:false, rtt, dateHdr:"" };

  const serverEpoch = new Date(date).getTime(); // ms
  // local midpoint (ms on epoch)
  const midLocal = performance.timeOrigin + (t0 + t3)/2;
  const offset = serverEpoch - midLocal; // server - local
  return { ok:true, rtt, offset, dateHdr:date, serverEpoch };
}

async function sampleTick(){
  try{
    const s = await headOnce(TARGET_URL);
    if (s.ok) {
      if (samples.length >= MAX_SAMPLES) samples.shift();
      samples.push(s);

      if (s.rtt < bestRTT) {
        bestRTT = s.rtt;
        bestOffset = s.offset;
      }
    }
    render();
  } catch (e) {
    // 네트워크 실패 시도중: 카운트/표시는 그대로, 다음 틱으로
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

// ====== UI ======
const $ = (id)=>document.getElementById(id);

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
  $('countdown').textContent = eta!=null ? fmtDur(eta) : "—";
  $('countdown').className = "countdown " + (
    eta==null ? "" : (eta<=0 ? "green blink" : (eta<1500 ? "warn" : ""))
  );
}

function bind(){
  $('save').onclick = () => {
    cfg.target_mode = $('mode').value;
    cfg.target_iso  = $('target').value;
    cfg.prefire_ms  = parseInt($('prefire').value || '120', 10);
    cfg.use_best_half_rtt = $('halfrtt').checked;
    render();
  };
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
