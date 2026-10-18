// konfetti für den sieg, ein canvas, ein paar sekunden

export function confetti(colors = ['#ffc73f', '#ff7ca0', '#5a99da', '#73e85d', '#c63fa2', '#ffffff']) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
  };
  resize();
  const bits = Array.from({ length: 180 }, () => ({
    x: Math.random() * canvas.width,
    y: -Math.random() * canvas.height * 0.6,
    w: (6 + Math.random() * 6) * dpr,
    h: (3 + Math.random() * 4) * dpr,
    vy: (2 + Math.random() * 3.5) * dpr,
    vx: (Math.random() - 0.5) * 2.4 * dpr,
    spin: Math.random() * Math.PI,
    vs: (Math.random() - 0.5) * 0.25,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const end = performance.now() + 5200;
  function frame(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const b of bits) {
      b.x += b.vx + Math.sin((t / 400) + b.spin) * 0.6;
      b.y += b.vy;
      b.spin += b.vs;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.spin);
      ctx.globalAlpha = Math.max(0, Math.min(1, (end - t) / 900));
      ctx.fillStyle = b.color;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    if (t < end) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
