import type { LegendaFrase } from "../db/repo.ts";
import type { Palavra } from "../ferramentas/midia.ts";
import { estiloCompleto, type EstiloLegenda } from "../../compartilhado/geometria.ts";

/*
 * Gera o arquivo .ass das legendas. Estilo dos cortes que viralizam: 1 a 3 palavras
 * por vez, caixa alta, contorno grosso, a palavra falada agora em amarelo. O gancho
 * fica numa tarja rosa no topo. Tudo em ASS pra ffmpeg queimar num filtro so.
 */

export const LARGURA = 1080;
export const ALTURA = 1920;

// ASS usa &HAABBGGRR.
const BRANCO = "&H00FFFFFF";
const AMARELO = "&H004DE1FF"; // #FFE14D
const ROSA = "&H00A34FFF"; // #FF4FA3
const PRETO = "&H00000000";
const SOMBRA = "&H78000000";
// Tag de override (\c) usa so &HBBGGRR&, sem o byte de transparencia.
const BRANCO_TAG = "&HFFFFFF&";

export interface OpcoesLegenda {
  palavras: Palavra[];
  duracao: number;
  /** Centro vertical da legenda, em px. */
  legendaY: number;
  gancho?: string | null;
  /** Ate quando o gancho fica na tela. Padrao: o video inteiro. */
  ganchoAte?: number;
  ganchoY?: number;
  /** Ex.: "#3" na compilacao. Aparece em cima do gancho. */
  rotulo?: string | null;
  credito?: string | null;
  marca?: string | null;
  /** Topo do credito em px. Sem valor = rodape. */
  creditoTopo?: number;
  fonte?: string;
  estilo?: EstiloLegenda | null;
}

export function tempoAss(s: number): string {
  // Arredonda pra centesimos ANTES de quebrar em h/m/s, senao 59.999 vira "0:00:60.00".
  const cs = Math.round(Math.max(0, s) * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const seg = Math.floor((cs % 6000) / 100);
  const resto = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(seg).padStart(2, "0")}.${String(resto).padStart(2, "0")}`;
}

/** Texto cru nunca pode abrir tag de override nem quebrar linha sem querer. */
export function escapar(txt: string): string {
  return txt.replace(/\\/g, "/").replace(/[{}]/g, "").replace(/\r?\n/g, " ");
}

/** Tira pontuacao que polui legenda de corte; mantem ? e ! que carregam emocao. */
function limparPalavra(w: string, maiusculas = true): string {
  const limpa = w.replace(/[.,;:"“”«»…]+/g, "").trim();
  return maiusculas ? limpa.toUpperCase() : limpa;
}

/** "#FFE14D" -> "&H4DE1FF&" (ASS guarda azul, verde, vermelho). */
export function corAss(hex: string): string {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? "FFE14D";
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
}

const MAX_PALAVRAS = 3;
const MAX_CHARS = 16;
const PAUSA_QUEBRA = 0.5;

/** Junta palavras em blocos curtos que cabem numa linha grande. */
export function agrupar(palavras: Palavra[], maiusculas = true): Palavra[][] {
  const blocos: Palavra[][] = [];
  let atual: Palavra[] = [];
  let chars = 0;
  for (const p of palavras) {
    const w = limparPalavra(p.w, maiusculas);
    if (!w) continue;
    const anterior = atual[atual.length - 1];
    const pausa = anterior ? p.i - anterior.f : 0;
    if (atual.length && (atual.length >= MAX_PALAVRAS || chars + w.length > MAX_CHARS || pausa > PAUSA_QUEBRA)) {
      blocos.push(atual);
      atual = [];
      chars = 0;
    }
    atual.push({ i: p.i, f: p.f, w });
    chars += w.length + 1;
    if (p.quebra || /[.!?]$/.test(p.w.trim())) {
      blocos.push(atual);
      atual = [];
      chars = 0;
    }
  }
  if (atual.length) blocos.push(atual);
  return blocos;
}

/**
 * Frases traduzidas (fonte gringa) nao tem tempo por palavra: reparte o tempo da
 * frase entre as palavras pelo tamanho de cada uma. Tempo de entrada e do video
 * original; a saida ja vem relativa ao inicio do corte.
 */
export function frasesParaPalavras(frases: LegendaFrase[], inicio: number, fim: number): Palavra[] {
  const out: Palavra[] = [];
  for (const fr of frases) {
    const a = Math.max(fr.inicio, inicio);
    const b = Math.min(fr.fim, fim);
    if (b <= a) continue;
    const ws = fr.texto.split(/\s+/).filter(Boolean);
    const pesos = ws.map((w) => w.length + 2);
    const total = pesos.reduce((x, y) => x + y, 0);
    let t = a;
    ws.forEach((w, k) => {
      const d = ((b - a) * pesos[k]!) / total;
      out.push({ i: t - inicio, f: t + d - inicio, w, quebra: k === ws.length - 1 });
      t += d;
    });
  }
  return out;
}

function cabecalho(fonte: string, legenda: { fonte: string; tamanho: number }): string {
  const estilo = (nome: string, tam: number, prim: string, contorno: string, fundo: string,
    borda: number, outline: number, shadow: number, alin: number, mv: number, f = fonte) =>
    `Style: ${nome},${f},${tam},${prim},&H000000FF,${contorno},${fundo},${f === "Bahnschrift" ? -1 : 0},0,0,0,100,100,0,0,${borda},${outline},${shadow},${alin},80,80,${mv},1`;
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${LARGURA}`,
    `PlayResY: ${ALTURA}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    estilo("Legenda", Math.round(86 * legenda.tamanho), BRANCO, PRETO, SOMBRA, 1, Math.round(7 * legenda.tamanho), 3, 5, 0, legenda.fonte),
    // BorderStyle 3 = tarja opaca; libass pinta a tarja com a cor de contorno.
    estilo("Gancho", 62, BRANCO, ROSA, ROSA, 3, 16, 0, 8, 0),
    estilo("Rotulo", 54, PRETO, AMARELO, AMARELO, 3, 12, 0, 8, 0),
    // Credito e @ do perfil com 50% de transparencia (&H80 no byte de alfa).
    estilo("Credito", 34, "&H80FFFFFF", "&H80000000", SOMBRA, 1, 3, 0, 2, 0),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
}

const evento = (camada: number, ini: number, fim: number, estilo: string, texto: string) =>
  `Dialogue: ${camada},${tempoAss(ini)},${tempoAss(fim)},${estilo},,0,0,0,,${texto}`;

export function gerarAss(o: OpcoesLegenda): string {
  const est = estiloCompleto(o.estilo);
  const destaque = corAss(est.cor);
  const linhas: string[] = [cabecalho(o.fonte ?? "Arial Black", { fonte: est.fonte, tamanho: est.tamanho })];
  const fim = o.duracao;

  if (o.gancho) {
    const y = o.ganchoY ?? 230;
    linhas.push(evento(2, 0, Math.min(o.ganchoAte ?? fim, fim), "Gancho",
      `{\\an8\\pos(${LARGURA / 2},${y})\\fad(120,0)}${escapar(o.gancho).toUpperCase()}`));
    if (o.rotulo) {
      linhas.push(evento(2, 0, Math.min(o.ganchoAte ?? fim, fim), "Rotulo",
        `{\\an2\\pos(${LARGURA / 2},${y - 30})}${escapar(o.rotulo)}`));
    }
  }
  const noTopo = o.creditoTopo !== undefined;
  const posCredito = (k: number) => noTopo
    ? `{\\an8\\pos(${LARGURA / 2},${o.creditoTopo! + k * 42})}`
    : `{\\an2\\pos(${LARGURA / 2},${ALTURA - 150 + k * 50})}`;
  if (o.credito) {
    linhas.push(evento(1, 0, fim, "Credito", `${posCredito(0)}${escapar(o.credito)}`));
  }
  if (o.marca) {
    linhas.push(evento(1, 0, fim, "Credito", `${posCredito(o.credito ? 1 : 0)}${escapar(o.marca)}`));
  }

  const blocos = agrupar(o.palavras, est.maiusculas);
  const legendaY = o.legendaY + est.deslocar;
  blocos.forEach((bloco, b) => {
    const proximoBloco = blocos[b + 1]?.[0]?.i ?? fim;
    const ultimo = bloco[bloco.length - 1]!;
    // Segura o bloco um pouco depois da ultima palavra, sem invadir o proximo.
    const fimBloco = Math.min(proximoBloco, ultimo.f + 0.35, fim);
    bloco.forEach((p, k) => {
      const ini = p.i;
      const ate = k < bloco.length - 1 ? bloco[k + 1]!.i : fimBloco;
      if (ate - ini < 0.04) return;
      const texto = bloco
        .map((q, j) => (j === k ? `{\\c${destaque}}${escapar(q.w)}{\\c${BRANCO_TAG}}` : escapar(q.w)))
        .join(" ");
      linhas.push(evento(0, ini, ate, "Legenda", `{\\an5\\pos(${LARGURA / 2},${legendaY})}${texto}`));
    });
  });

  return linhas.join("\n") + "\n";
}
