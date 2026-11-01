// Keski-C tests: node keski-c/tests/run.js        (fast, run by GitHub on every change)
//                FULL=1 node keski-c/tests/run.js (every microphone condition, takes ~20 min)
"use strict";
const { lib, songs, stepsOf, nm, listen, detectNotes } = require("./lib.js");
const FULL = !!process.env.FULL;
let pass = 0, fail = 0;
const check = (ok, label, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " · " + detail : ""}`); };

/* 1. Song data: every voice of a song is equally long, lyrics match the notes */
console.log("\n— Kappaleiden rakenne");
for (const s of Object.values(songs)){
  const beats = seq => seq.trim().split(/\s+/).reduce((a, t) => a + lib.parseTok(t.split("+").pop()).dur, 0);
  const voices = [s.rh, s.lh, s.lh2].filter(Boolean).map(beats);
  const notes = s.rh.trim().split(/\s+/).filter(t => !t.startsWith("R")).length;
  const sylls = s.lyrics ? s.lyrics.split(" ").length : notes;
  check(voices.every(b => Math.abs(b - voices[0]) < 1e-9) && (!s.lyrics || sylls === notes),
    s.id, `iskuja ${voices.join("/")}${s.lyrics ? `, tavuja ${sylls}/${notes}` : ""}`);
}
for (const p of lib.PROGRESSIONS){
  check(p.steps.length === p.bars.length * p.pattern.split(" ").length && p.bars.every(c => lib.CHORDS[c]),
    "sointukierto " + p.id, `${p.bars.length} tahtia, ${p.steps.length} askelta`);
}

/* 2. Single notes (one-hand songs, note reading) */
console.log("\n— Yksittäiset sävelet");
const single = (label, seq, opt) => {
  const want = seq.map(s => s[0]), got = detectNotes(seq, opt);
  check(JSON.stringify(want) === JSON.stringify(got), label, got.length === want.length ? "" : `odotettiin ${want.map(nm).join(" ")}, kuultiin ${got.map(nm).join(" ")}`);
};
const ukko = [60,60,60,64,62,62,62,65,64,64,62,62,60];
single("Ukko Nooa, toistuvat sävelet", ukko.map((m, i) => [m, 0.3 + i*0.4, 0.35]));
single("hiljaa soitettu", ukko.map((m, i) => [m, 0.3 + i*0.4, 0.35, 0.08]), { noise: 0.003 });
single("asteikko C4–C6 nopeasti", [60,62,64,65,67,69,71,72,74,76,77,79,81,83,84].map((m, i) => [m, 0.3 + i*0.25, 0.25]));
single("matalat ja korkeat E2–C7", [40,45,48,55,91,96].map((m, i) => [m, 0.3 + i*0.5, 0.4]));
single("mustat koskettimet", [61,63,66,68,70,73,75].map((m, i) => [m, 0.3 + i*0.4, 0.3]));
single("44.1 kHz", [62,67].map((m, i) => [m, 0.3 + i*0.7, 0.6]), { sr: 44100 });
single("toistot ilman taukoa + puhelin", ukko.map((m, i) => [m, 0.3 + i*0.4, 0.4]), { agc: true, thump: true });
single("pitkä sävel, kielten huojunta", [[60, 0.3, 3.5]], { beat: 3 });
if (FULL){
  const sc = [60,62,64,65,67,69,71,72,74,76,77,79,81,83,84,83,81,79,77,76,74,72,71,69,67,65,64,62];
  const long = []; for (let r = 0; r < 4; r++) sc.forEach((m, i) => long.push([m, 0.3 + (r*sc.length + i)*0.22, 0.24]));
  single("asteikko 4 kertaa tauotta", long);
  single("kovaa tauotta", long.map(([m, t, d]) => [m, t, d, 0.6]), { noise: 0.01 });
  single("hiljaa, toistot + puhelin", ukko.map((m, i) => [m, 0.3 + i*0.6, 0.6, 0.1]), { agc: true, noise: 0.003 });
}

/* 3. Two-hand songs through the microphone check */
console.log("\n— Kahden käden kappaleet mikrofonilla");
const conditions = [{ label: "perus", bpm: 72 }, { label: "puhelin", bpm: 72, agc: true, thump: true }];
if (FULL) conditions.push({ label: "nopeampi", bpm: 100 }, { label: "44.1 kHz", bpm: 72, sr: 44100 });
const twoHand = Object.values(songs).filter(s => s.hands === 2).map(s => s.id);
for (const id of twoHand){
  const steps = stepsOf(id);
  for (const c of conditions){
    const r = listen(steps, c);
    check(r.pos === r.total && !r.errs.length, `${id} · ${c.label}`, `${r.pos}/${r.total} askelta${r.errs.length ? `, ensimmäinen virhe askeleessa ${r.errs[0].step}` : ""}`);
  }
  // a wrong note (a semitone up) must be caught on the right step; octave pairs can't be told apart, so skip them
  const every = FULL ? 11 : 23;
  for (let si = 3; si < steps.length; si += every){
    const st = steps[si], note = st.notes.find(n => n.hand === "R");
    if (!note || st.notes.some(o => o !== note && (note.midi - o.midi) % 12 === 0)) continue;
    if (si > 0 && steps[si-1].notes.some(o => o.midi === note.midi)) continue; // a repeated note still ringing: the app waits instead
    const r = listen(steps, { bpm: 72, swap: { step: si, from: note.midi, to: note.midi + 1 } });
    check(r.errs.length > 0 && r.errs[0].step === si, `${id} · väärä sävel askeleessa ${si}`, `${nm(note.midi)} → ${nm(note.midi + 1)}: ${r.errs.length ? "huomattiin askeleessa " + r.errs[0].step : "ei huomattu"}`);
  }
}

/* 4. Chord progressions: two rounds in a row */
console.log("\n— Sointukierrot mikrofonilla");
for (const p of lib.PROGRESSIONS){
  const barLen = p.pattern.split(" ").length * p.beat, steps = [];
  for (let r = 0; r < 2; r++) p.steps.forEach(s => steps.push({ ...s, t: s.t + r*p.bars.length*barLen }));
  const conds = [{ label: "perus", bpm: 120 }, { label: "44.1 kHz", bpm: 120, sr: 44100 }];
  if (FULL) conds.push({ label: "puhelin", bpm: 120, agc: true, thump: true }, { label: "nopea", bpm: 160 });
  for (const c of conds){
    const r = listen(steps, c, "chords");
    check(r.pos === r.total && !r.errs.length, `${p.id} · ${c.label}`, `${r.pos}/${r.total} askelta`);
  }
  for (let si = 1; si < p.steps.length; si += FULL ? 5 : 9){
    const st = p.steps[si], nt = st.notes[st.notes.length - 1];
    const r = listen(steps, { bpm: 120, swap: { step: si, from: nt.midi, to: nt.midi + 1 } }, "chords");
    check(r.errs.length > 0 && r.errs[0].step === si, `${p.id} · väärä sävel askeleessa ${si}`, `${st.chord}: ${nm(nt.midi)} → ${nm(nt.midi + 1)}`);
  }
}

console.log(`\n${pass}/${pass + fail} läpi${FULL ? " (kaikki olosuhteet)" : ""}`);
process.exit(fail ? 1 : 0);
