import { ALTURA, LARGURA, calcular, type Edicao, type Geometria, type Layout } from "../../compartilhado/geometria.ts";

/*
 * Transforma a geometria (compartilhada com a previa do painel) no filter_complex
 * do ffmpeg. Funcao pura (testada); quem roda o ffmpeg e o render.ts. A legenda
 * entra por ultimo, com caminho relativo (o ffmpeg roda com cwd na pasta do
 * render), pra fugir do inferno de escapar "C:\" dentro de filtro.
 */

export type { Layout };

export interface Plano {
  filtro: string;
  legendaY: number;
  ganchoY: number;
  ganchoAte: number | null;
  creditoTopo?: number;
}

const SAIDA = "setsar=1,fps=30,subtitles=legenda.ass:fontsdir=fontes[v]";

export function filtroDe(g: Geometria): string {
  const n = g.paineis.length + (g.fundo ? 1 : 0);
  const rotulos = Array.from({ length: n }, (_, k) => `[s${k}]`);
  // Primeiro borra a regiao "tapar" no video original; tudo depois parte dele.
  let base = "[0:v]";
  const partes: string[] = [];
  if (g.tapar) {
    const t = g.tapar;
    // O ffmpeg recusa raio maior que metade do lado (e a cor tem metade da resolucao).
    const raio = Math.max(1, Math.min(20, Math.floor(Math.min(t.w, t.h) / 2) - 1));
    const raioCor = Math.max(1, Math.min(10, Math.floor(Math.min(t.w, t.h) / 4) - 1));
    partes.push(`[0:v]split=2[orig][ptap]`,
      `[ptap]crop=${t.w}:${t.h}:${t.x}:${t.y},boxblur=${raio}:4:${raioCor}:4[tap]`,
      `[orig][tap]overlay=${t.x}:${t.y}[base]`);
    base = "[base]";
  }
  partes.push(n > 1 ? `${base}split=${n}${rotulos.join("")}` : `${base}null[s0]`);

  let k = 0;
  if (g.fundo) {
    // Borra em baixa resolucao e amplia depois: mesmo visual, bem mais rapido.
    partes.push(`[s${k++}]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=8:2,` +
      `scale=${LARGURA}:${ALTURA},eq=brightness=-0.2:saturation=1.3[fundo]`);
  }
  g.paineis.forEach((p, i) => {
    partes.push(`[s${k++}]crop=${p.origem.w}:${p.origem.h}:${p.origem.x}:${p.origem.y},` +
      `scale=${p.destino.w}:${p.destino.h}[p${i}]`);
  });

  if (g.fundo) {
    partes.push(`[fundo][p0]overlay=${g.paineis[0]!.destino.x}:${g.paineis[0]!.destino.y},${SAIDA}`);
  } else if (g.paineis.length > 1) {
    // Os paineis ja vem na ordem de cima pra baixo e fecham a tela certinho.
    partes.push(`${g.paineis.map((_, i) => `[p${i}]`).join("")}vstack=inputs=${g.paineis.length},${SAIDA}`);
  } else {
    partes.push(`[p0]${SAIDA}`);
  }
  return partes.join(";");
}

export function planejar(layout: Layout, largura: number, altura: number, edicao: Edicao = {}): Plano {
  const g = calcular(layout, largura, altura, edicao);
  return { filtro: filtroDe(g), legendaY: g.legendaY, ganchoY: g.ganchoY, ganchoAte: g.ganchoAte, creditoTopo: g.creditoTopo };
}

export interface ArgsCorte {
  entrada: string;
  inicio: number;
  duracao: number;
  filtro: string;
  temAudio: boolean;
  saida: string;
  /** Narracao (dica): substitui o audio do video, que fica baixinho de fundo. */
  narracao?: string;
}

export function argsFfmpeg(a: ArgsCorte): string[] {
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-stats"];
  // -ss antes do -i: busca rapida, e com reencode o corte sai no quadro certo.
  if (a.narracao) args.push("-stream_loop", "-1");
  args.push("-ss", a.inicio.toFixed(3), "-t", a.duracao.toFixed(3), "-i", a.entrada);

  let filtroAudio: string;
  if (a.narracao) {
    args.push("-i", a.narracao);
    filtroAudio = a.temAudio
      ? `[1:a]volume=1.0[nar];[0:a]volume=0.07[fundo_a];[nar][fundo_a]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`
      : `[1:a]loudnorm=I=-14:TP=-1.5:LRA=11[aout]`;
  } else if (a.temAudio) {
    filtroAudio = `[0:a]loudnorm=I=-14:TP=-1.5:LRA=11[aout]`;
  } else {
    // Compilacao concatena as partes: toda parte precisa ter faixa de audio.
    args.push("-f", "lavfi", "-t", a.duracao.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
    filtroAudio = `[1:a]anull[aout]`;
  }

  args.push(
    "-filter_complex", `${a.filtro};${filtroAudio}`,
    "-map", "[v]", "-map", "[aout]",
    "-t", a.duracao.toFixed(3),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    a.saida
  );
  return args;
}
