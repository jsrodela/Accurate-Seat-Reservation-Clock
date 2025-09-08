#!/usr/bin/env node
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

const args = process.argv.slice(2);
function argv(name, def=null){ 
  const i = args.indexOf('--'+name);
  if(i>=0) return args[i+1] ?? true;
  return def;
}

const TARGET_URL = argv('url', 'https://myrussel.megastudy.net/reserve/reserve_list.asp');
const MODE = argv('mode', 'local'); // 'local' or 'server'
const TARGET_ISO = argv('target', '');
const PREFIRE_MS = parseInt(argv('prefire', '120'), 10);
const USE_HALF_RTT = args.includes('--halfrtt');

const samples=[], MAX_SAMPLES=240;

function headOnce(u){
  return new Promise((resolve)=> {
    const t0 = Date.now();
    const urlObj = new URL(u);
    const mod = (urlObj.protocol === 'https:') ? https : http;
    const req = mod.request(urlObj, { method: 'HEAD' }, (res)=>{
      const date = res.headers['date'] || null;
      const t3 = Date.now();
      const rtt = t3 - t0;
      let serverMs=null, offsetMs=null;
      if(date){
        const dt = new Date(date);
        if(!isNaN(dt.getTime())){
          serverMs = dt.getTime();
          const midpoint=(t0+t3)/2;
          offsetMs = serverMs - midpoint;
        }
      }
      resolve({ok:!!serverMs, t0_ms:t0, t3_ms:t3, rtt_ms:rtt, server_date_ms:serverMs, offset_ms:offsetMs, date_header:date||''});
    });
    req.on('error', ()=>resolve({ok:false, t0_ms:t0, t3_ms:Date.now(), rtt_ms:NaN, server_date_ms:null, offset_ms:null, date_header:''}));
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
  const rtts = ok.map(s=>s.rtt_ms).filter(x=>!isNaN(x));
  offsets.sort((a,b)=>a-b);
  const mid = Math.floor(offsets.length/2);
  const median = (offsets.length%2===1)? offsets[mid] : (offsets[mid-1]+offsets[mid])/2;
  const nowLocal = Date.now();
  const nowServer = nowLocal + best.offset_ms;
  const mean = a=>a.reduce((p,c)=>p+c,0)/a.length;
  const pstdev = a=>{ if(a.length<=1) return 0; const m=mean(a); return Math.sqrt(a.reduce((p,c)=>p+(c-m)*(c-m),0)/a.length); };
  return { have_samples:true, now_local_ms:nowLocal, now_server_ms:nowServer, offset_ms:best.offset_ms,
    offset_median_ms:median, offset_stdev_ms:pstdev(offsets), rtt_ms:mean(rtts), rtt_stdev_ms:pstdev(rtts),
    best_rtt_ms:best.rtt_ms, count:ok.length, last_date_header:ok[ok.length-1].date_header };
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

function fmtTime(ms){
  if(ms==null) return '--:--:--.---';
  const d=new Date(ms);
  const hh=String(d.getHours()).padStart(2,'0');
  const mm=String(d.getMinutes()).padStart(2,'0');
  const ss=String(d.getSeconds()).padStart(2,'0');
  const ms3=String(d.getMilliseconds()).padStart(3,'0');
  return `${hh}:${mm}:${ss}.${ms3}`;
}
function fmtDur(ms){
  if(ms==null) return '—';
  const neg=ms<0; ms=Math.abs(ms);
  const s=Math.floor(ms/1000), m=Math.floor(s/60), rs=s%60;
  const ms3=String(Math.floor(ms%1000)).padStart(3,'0');
  return (neg?'-':'')+String(m).padStart(2,'0')+':'+String(rs).padStart(2,'0')+'.'+ms3;
}

(async function main(){
  console.log('[Russel Clock CLI] polling:', TARGET_URL);
  setInterval(async ()=>{
    const s = await headOnce(TARGET_URL);
    samples.push(s);
    if(samples.length>MAX_SAMPLES) samples.shift();

    const st = stats();
    const targetServer = parseTargetToServerMs(TARGET_ISO, MODE);
    let clickLocal = null, eta = null;
    if(targetServer!=null && st.have_samples && st.offset_ms!=null){
      const travel = (USE_HALF_RTT && st.best_rtt_ms)? (st.best_rtt_ms/2) : 0;
      clickLocal = targetServer - st.offset_ms - PREFIRE_MS - travel;
      eta = clickLocal - st.now_local_ms;
    }

    process.stdout.write('\x1b[2K\r');
    process.stdout.write([
      `local=${fmtTime(st.now_local_ms)}`,
      `server=${fmtTime(st.now_server_ms)}`,
      `offset=${st.offset_ms!=null?Math.round(st.offset_ms)+'ms':'--'}`,
      `rtt=${st.rtt_ms!=null?Math.round(st.rtt_ms):'--'}/${st.best_rtt_ms!=null?Math.round(st.best_rtt_ms):'--'}ms`,
      `click=${clickLocal?fmtTime(clickLocal):'—'}`,
      `ETA=${fmtDur(eta)}`
    ].join('  '));
  }, 1000);
})();
