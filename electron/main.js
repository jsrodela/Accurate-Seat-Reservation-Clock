import { app, BrowserWindow, ipcMain } from 'electron';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET_URL = 'https://myrussel.megastudy.net/reserve/reserve_list.asp';

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 980, height: 520, backgroundColor: '#0b1020',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.removeMenu();
  win.loadFile('renderer.html');
}
app.whenReady().then(createWindow);

const samples = [];
const MAX_SAMPLES = 240;

function headOnce(u){
  return new Promise((resolve)=> {
    const t0 = Date.now();
    const urlObj = new URL(u);
    const mod = (urlObj.protocol === 'https:') ? https : http;
    const req = mod.request(urlObj, { method:'HEAD' }, (res)=>{
      const date = res.headers['date'] || null;
      const t3 = Date.now();
      const rtt = t3 - t0;
      let serverMs=null, offsetMs=null;
      if(date){
        const dt = new Date(date);
        if(!isNaN(dt.getTime())){
          serverMs = dt.getTime();
          const midpoint = (t0 + t3)/2;
          offsetMs = serverMs - midpoint;
        }
      }
      resolve({ ok:!!serverMs, t0_ms:t0, t3_ms:t3, rtt_ms:rtt, server_date_ms:serverMs, offset_ms:offsetMs, date_header:date||'' });
    });
    req.on('error', ()=>resolve({ok:false, t0_ms:Date.now(), t3_ms:Date.now(), rtt_ms:NaN, server_date_ms:null, offset_ms:null, date_header:''}));
    req.end();
  });
}

function stats(){
  const ok = samples.filter(s=>s.ok);
  if(!ok.length){
    return { have_samples:false, now_local_ms:Date.now(), now_server_ms:null,
      offset_ms:null, rtt_ms:null, best_rtt_ms:null, offset_stdev_ms:null, rtt_stdev_ms:null,
      count:0, last_date_header: samples.length? samples[samples.length-1].date_header : '' };
  }
  const best = ok.reduce((a,b)=>a.rtt_ms<b.rtt_ms?a:b);
  const offsets = ok.map(s=>s.offset_ms).filter(x=>x!==null);
  const rtts = ok.map(s=>s.rtt_ms);
  offsets.sort((a,b)=>a-b);
  const mid = Math.floor(offsets.length/2);
  const median = (offsets.length%2===1)?offsets[mid]:(offsets[mid-1]+offsets[mid])/2;
  const nowLocal = Date.now();
  const nowServer = nowLocal + best.offset_ms;
  const mean = arr=>arr.reduce((p,c)=>p+c,0)/arr.length;
  const pstdev = arr=>{ if(arr.length<=1) return 0; const m=mean(arr); return Math.sqrt(arr.reduce((p,c)=>p+(c-m)*(c-m),0)/arr.length); };
  return {
    have_samples:true,
    now_local_ms: nowLocal,
    now_server_ms: nowServer,
    offset_ms: best.offset_ms,
    offset_median_ms: median,
    offset_stdev_ms: pstdev(offsets),
    rtt_ms: mean(rtts),
    rtt_stdev_ms: pstdev(rtts),
    best_rtt_ms: best.rtt_ms,
    count: ok.length,
    last_date_header: ok[ok.length-1].date_header
  };
}

function parseTargetToServerMs(iso, mode){
  if(!iso) return null;
  let s = iso.trim().replace('T',' ');
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(s)) s += ':00';
  const d = new Date(s);
  if(isNaN(d.getTime())) return null;
  const local_ms = d.getTime();
  const st = stats();
  if(!st.have_samples) return null;
  return (mode==='local') ? (local_ms + st.offset_ms) : local_ms;
}

let cfg = { prefire_ms:120, use_best_half_rtt:true, target_mode:'local', target_iso:'' };

ipcMain.handle('get-state', ()=> {
  const st = stats();
  let targetServer=null, clickLocal=null, eta=null;
  if(cfg.target_iso){
    targetServer = parseTargetToServerMs(cfg.target_iso, cfg.target_mode);
    if(targetServer!=null && st.have_samples && st.offset_ms!=null){
      const travel = (cfg.use_best_half_rtt && st.best_rtt_ms)? st.best_rtt_ms/2 : 0;
      clickLocal = targetServer - st.offset_ms - cfg.prefire_ms - travel;
      eta = clickLocal - st.now_local_ms;
    }
  }
  return { stats:st, config:cfg, target_server_ms: targetServer, recommended_local_click_ms: clickLocal, eta_ms: eta };
});
ipcMain.on('set-config', (_e, newCfg)=> { cfg = { ...cfg, ...newCfg }; });

setInterval(async ()=>{
  try{
    const s = await headOnce(TARGET_URL);
    samples.push(s);
    if(samples.length>MAX_SAMPLES) samples.shift();
    win?.webContents.send('tick');
  }catch(_){}
}, 1000);
