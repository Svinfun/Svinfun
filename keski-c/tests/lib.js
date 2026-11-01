// Test helpers for Keski-C. The app's own code is read from ../index.html, so the tests always check
// what is published. Piano sound is simulated: inharmonic partials, decay, hammer noise and the volume
// levelling a phone microphone does.
"use strict";
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const js = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
const between = (a, b) => {
  const i = js.indexOf(a), j = js.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error(`Koodista puuttuu merkki ${a} … ${b}`);
  return js.slice(i, j);
};

const lib = new Function(
  between("const LETTER", "/* ---------- storage") +
  between("// DETECTOR-START", "// DETECTOR-END") +
  between("// CHORD-START", "// CHORD-END") +
  between("// PROG-START", "// PROG-END") +
  ";return { parseTok, buildSteps, createDetector, chordCheck, createChordListener, FLUX_SONG, FLUX_CHORDS, CHORDS, PROGRESSIONS };"
)();

// Song data straight from the SONGS list
const songs = {};
const songsSrc = between("const SONGS = [", "].map(s => {");
for (const blk of songsSrc.split('{ id:"').slice(1)){
  const id = blk.slice(0, blk.indexOf('"'));
  const f = k => (blk.match(new RegExp("\\b" + k + ':"([^"]+)"')) || [])[1];
  const hands = /hands:2/.test(blk) ? 2 : 1;
  songs[id] = { id, hands, rh: f("rh"), lh: f("lh"), lh2: f("lh2"), lyrics: f("lyrics") };
}
function stepsOf(id){
  const s = songs[id];
  return lib.buildSteps([{ hand: "R", seq: s.rh }, ...(s.lh ? [{ hand: "L", seq: s.lh }] : []), ...(s.lh2 ? [{ hand: "L", seq: s.lh2 }] : [])]);
}

const NAMES = ["C","Cis","D","Dis","E","F","Fis","G","Gis","A","B","H"];
const nm = m => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

// FFT + Blackman window + dB, like the browser's AnalyserNode
function fftDb(x, N){
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++){ const w = 0.42 - 0.5*Math.cos(2*Math.PI*i/N) + 0.08*Math.cos(4*Math.PI*i/N); re[i] = x[i]*w; }
  for (let i = 1, j = 0; i < N; i++){ let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j){ [re[i], re[j]] = [re[j], re[i]]; } }
  for (let len = 2; len <= N; len <<= 1){
    const a = -2*Math.PI/len;
    for (let i = 0; i < N; i += len) for (let k = 0; k < len/2; k++){
      const c = Math.cos(a*k), s = Math.sin(a*k), h = i + k + len/2;
      const vr = re[h]*c - im[h]*s, vi = re[h]*s + im[h]*c, ur = re[i+k], ui = im[i+k];
      re[i+k] = ur + vr; im[i+k] = ui + vi; re[h] = ur - vr; im[h] = ui - vi;
    }
  }
  const out = new Float32Array(N/2);
  for (let i = 0; i < N/2; i++) out[i] = 20*Math.log10(Math.hypot(re[i], im[i])/N + 1e-12);
  return out;
}

// Simulated piano. steps: [{ notes:[{midi,dur,hand}], len }]. swap: { step, from, to } plays a wrong note (to = null: leave it out)
function render(steps, { sr = 48000, bpm = 72, agc = false, thump = false, noise = 0.002, swap = null } = {}){
  const beat = 60/bpm, lead = 0.5;
  const n = Math.floor((lead + steps.reduce((a, s) => a + s.len, 0)*beat + 1.5)*sr);
  const x = new Float32Array(n);
  let seed = 7; const rnd = () => ((seed = seed*16807 % 2147483647)/2147483647 - 0.5);
  let T = lead;
  steps.forEach((st, si) => {
    for (const note of st.notes){
      let m = note.midi;
      if (swap && swap.step === si && swap.from === m){ if (swap.to == null) continue; m = swap.to; }
      const f = 440*2**((m - 69)/12), i0 = Math.floor(T*sr), dur = note.dur*beat, a = 0.25*(note.hand === "L" ? 0.8 : 1);
      const i1 = Math.min(n, i0 + Math.floor((dur + 0.3)*sr));
      for (let k = 1; k <= 12; k++){
        const fk = f*k*Math.sqrt(1 + 0.0004*k*k); if (fk > sr/2.2) break;
        const ak = a/Math.pow(k, 1.1)*(m < 52 && k === 1 ? 0.35 : 1), dec = 0.8 + k*0.5;
        for (let i = i0; i < i1; i++){
          const t = (i - i0)/sr; let e = Math.min(1, t/0.004)*Math.exp(-dec*t);
          if (t > dur) e *= Math.exp(-(t - dur)*25);
          x[i] += ak*e*Math.sin(2*Math.PI*fk*t + k*1.7 + m);
        }
      }
      if (thump) for (let i = i0; i < Math.min(n, i0 + sr*0.02); i++) x[i] += a*0.15*rnd()*2*Math.exp(-(i - i0)/sr*250);
    }
    T += st.len*beat;
  });
  for (let i = 0; i < n; i++) x[i] += noise*rnd()*2;
  if (agc){ let env = 0.01; for (let i = 0; i < n; i++){ const v = Math.abs(x[i]); env += (v - env)*(v > env ? 0.002 : 0.00003); x[i] *= Math.min(30, 0.25/Math.max(env, 1e-3)); } }
  return x;
}

// Run steps through the same microphone pipeline as the app. mode "song": unsure results wait;
// "chords": unsure results move on (hands take turns) and the lower strike threshold is used.
function listen(steps, opt = {}, mode = "song"){
  const sr = opt.sr || 48000, F = 4096, x = render(steps, { ...opt, sr });
  const det = lib.createDetector(sr), hop = Math.round(sr/60);
  let pos = 0; const errs = [];
  const L = lib.createChordListener(sr/F, () => pos < steps.length ? steps[pos].notes.map(n => n.midi) : null, res => {
    if (res.ok || (mode === "chords" && res.unsure)){ pos++; return; }
    if (res.unsure || res.maybe) return;
    errs.push({ step: pos, missing: res.missing });
  }, () => mode === "chords" ? lib.FLUX_CHORDS : lib.FLUX_SONG);
  for (let e = F; e < x.length && pos < steps.length; e += hop){
    const t = e/sr, r = det.process(x.subarray(e - 2048, e), t);
    L.frame(t, fftDb(x.subarray(e - F, e), F), r.events.some(ev => ev.type === "onset"), r.rms > r.gate);
  }
  return { pos, total: steps.length, errs };
}

// Single notes through the pitch detector (one-hand songs, note reading, free play)
function detectNotes(seq, { sr = 48000, noise = 0.002, amp = 0.3, agc = false, thump = false, beat = 0 } = {}){
  const total = seq.reduce((a, s) => Math.max(a, s[1] + s[2] + 0.5), 0), n = Math.floor(total*sr);
  const x = new Float32Array(n); let seed = 1; const rnd = () => ((seed = seed*16807 % 2147483647)/2147483647 - 0.5);
  for (const [m, t0, dur, a = amp] of seq){
    const f = 440*2**((m - 69)/12), i0 = Math.floor(t0*sr), i1 = Math.min(n, Math.floor((t0 + dur)*sr) + Math.floor(0.15*sr));
    for (let k = 1; k <= 12; k++){
      const fk = f*k*Math.sqrt(1 + 0.0004*k*k); if (fk > sr/2.2) break;
      const ak = a/Math.pow(k, 1.1)*(k === 1 && m < 52 ? 0.4 : 1), dec = 1.2 + k*0.6;
      for (let i = i0; i < i1; i++){
        const t = (i - i0)/sr; let env = Math.min(1, t/0.004)*Math.exp(-dec*t);
        if (t > dur) env *= Math.exp(-(t - dur)*25);
        x[i] += ak*env*(beat ? 0.7*Math.sin(2*Math.PI*fk*t + k) + 0.3*Math.sin(2*Math.PI*(fk + beat)*t) : Math.sin(2*Math.PI*fk*t + k));
      }
    }
  }
  if (thump) for (const [, t0, , a = amp] of seq){ const i0 = Math.floor(t0*sr); for (let i = i0; i < Math.min(n, i0 + sr*0.02); i++) x[i] += a*0.15*rnd()*2*Math.exp(-(i - i0)/sr*250); }
  for (let i = 0; i < n; i++) x[i] += noise*rnd()*2;
  if (agc){ let env = 0.01; for (let i = 0; i < n; i++){ const v = Math.abs(x[i]); env += (v - env)*(v > env ? 0.002 : 0.00003); x[i] *= Math.min(30, 0.25/Math.max(env, 1e-3)); } }
  const d = lib.createDetector(sr), hop = Math.round(sr/60), out = [];
  for (let e = d.size + 2048; e < n; e += hop){
    const r = d.process(x.subarray(e - 2048, e), e/sr);
    for (const ev of r.events) if (ev.type === "on") out.push(ev.midi);
  }
  return out;
}

module.exports = { lib, songs, stepsOf, nm, render, listen, detectNotes };
