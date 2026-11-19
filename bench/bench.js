'use strict';
const C = require('../src');
const w = C.generateWorld({ seed: 'aurora' });
const cam = C.createCamera(w);
for (const [cols, rows] of [[80, 24], [120, 44], [200, 70], [320, 100]]) {
  const f = C.createFrame(cols, rows);
  for (let i = 0; i < 20; i++) C.render(f, w, cam, { time: 21 });
  const N = 200, t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) { cam.angle += 0.02; C.render(f, w, cam, { time: 21 }); }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  console.log(`${cols}x${rows}`.padEnd(9), ms.toFixed(2).padStart(7), 'ms/frame', (1000 / ms).toFixed(0).padStart(6), 'fps');
}
