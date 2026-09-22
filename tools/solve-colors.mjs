// Seventeen feelings, seventeen colors. Each one has to clear 3:1 contrast
// against BOTH surfaces — the light page (#fcfcfb) and the dark one (#1a1a19) —
// so a single hex can carry the feeling's identity in either theme. We fix the
// hue and saturation by hand and solve for the lightness that clears both.
const SURF = { light: '#fcfcfb', dark: '#1a1a19' };
const HUES = [
  ['not-in-control', 272, 52], ['fine', 205, 12], ['happy', 45, 85],
  ['sad', 215, 65], ['anxious', 295, 42], ['angry', 4, 70],
  ['excited', 25, 85], ['irritable', 352, 38], ['hopeful', 172, 60],
  ['grateful', 140, 45], ['confident', 195, 70], ['social', 336, 62],
  ['anti-social', 222, 22], ['smart', 243, 55], ['dumb', 30, 28],
  ['ugly', 78, 40], ['beautiful', 315, 50], ['stressed', 294, 23],
];
const hex2rgb = h => [1,3,5].map(i => parseInt(h.slice(i, i+2), 16));
const lum = rgb => { const c = rgb.map(v => { v/=255; return v<=0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; }); return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; };
const contrast = (a, b) => { const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
function hsl2hex(h, s, l) {
  s/=100; l/=100;
  const k = n => (n + h/30) % 12;
  const a = s * Math.min(l, 1-l);
  const f = n => l - a * Math.max(-1, Math.min(k(n)-3, Math.min(9-k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
}
const L = hex2rgb(SURF.light), D = hex2rgb(SURF.dark);
const out = [];
for (const [name, h, s] of HUES) {
  let best = null;
  for (let l = 30; l <= 72; l += 0.5) {
    const hex = hsl2hex(h, s, l), rgb = hex2rgb(hex);
    const cl = contrast(rgb, L), cd = contrast(rgb, D);
    if (cl >= 3 && cd >= 3) {
      const margin = Math.min(cl, cd);            // pick the most balanced lightness
      if (!best || margin > best.margin) best = { hex, cl, cd, margin, l };
    }
  }
  if (!best) { console.log(`${name}: NO LIGHTNESS WORKS at s=${s}`); continue; }
  out.push([name, best.hex]);
  console.log(`${name.padEnd(16)} ${best.hex}  light ${best.cl.toFixed(2)}:1  dark ${best.cd.toFixed(2)}:1`);
}
console.log('\n' + JSON.stringify(Object.fromEntries(out), null, 2));
