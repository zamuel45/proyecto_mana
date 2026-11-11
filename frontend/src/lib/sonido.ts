/* Aviso sonoro corto (sin archivos de audio) y vibración en celulares. */
let ctx: AudioContext | null = null;

export function sonar(tipo: 'nuevo' | 'aviso' | 'alerta' = 'nuevo') {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    const notas = tipo === 'nuevo' ? [880, 1175] : tipo === 'aviso' ? [660, 880, 1046] : [440, 330];
    notas.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t0 = ctx!.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
      o.connect(g).connect(ctx!.destination);
      o.start(t0);
      o.stop(t0 + 0.16);
    });
  } catch {
    /* sin audio disponible */
  }
  try {
    navigator.vibrate?.(tipo === 'alerta' ? [200, 100, 200] : 180);
  } catch {
    /* sin vibración */
  }
}
