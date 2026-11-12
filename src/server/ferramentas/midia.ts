import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import { rodarOk } from "./processo.ts";

/** `quebra` = ultima palavra de uma fala: a legenda fecha o bloco ali. */
export interface Palavra { i: number; f: number; w: string; quebra?: boolean }
export interface Segmento { i: number; f: number; t: string; p: Palavra[] }
export interface Transcricao { idioma: string; duracao: number; segmentos: Segmento[] }

export interface Sonda { largura: number; altura: number; duracao: number; temAudio: boolean }

export async function sondar(arquivo: string): Promise<Sonda> {
  const s = await rodarOk(config.ffprobe, [
    "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", arquivo,
  ]);
  const d = JSON.parse(s.stdout) as {
    streams?: { codec_type: string; width?: number; height?: number }[];
    format?: { duration?: string };
  };
  const v = d.streams?.find((x) => x.codec_type === "video");
  return {
    largura: v?.width ?? 0,
    altura: v?.height ?? 0,
    duracao: Number(d.format?.duration ?? 0),
    temAudio: !!d.streams?.some((x) => x.codec_type === "audio"),
  };
}

export async function transcrever(
  entrada: string,
  saida: string,
  idioma: string | null,
  progresso?: (frac: number) => void
): Promise<Transcricao> {
  await rodarOk(config.python, [
    join(config.workers, "transcrever.py"), entrada, saida, idioma || "auto", config.whisperModelo,
  ], {
    env: { FFMPEG: config.ffmpeg },
    linha: (l) => {
      if (!l.startsWith("{") || !progresso) return;
      try { progresso((JSON.parse(l) as { progresso: number }).progresso); } catch { /* linha de log */ }
    },
  });
  return lerTranscricao(saida);
}

export function lerTranscricao(arquivo: string): Transcricao {
  return JSON.parse(readFileSync(arquivo, "utf8")) as Transcricao;
}

const mmss = (s: number) => {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
};

/**
 * Versao compacta pro Claude ler: uma linha por segmento com o tempo em segundos.
 * Bem menos token que o JSON com cada palavra.
 */
export function transcricaoCompacta(t: Transcricao, de = 0, ate = Infinity): string {
  return t.segmentos
    .filter((s) => s.f >= de && s.i <= ate)
    .map((s) => `[${s.i.toFixed(1)}-${s.f.toFixed(1)} | ${mmss(s.i)}] ${s.t}`)
    .join("\n");
}

/** Palavras dentro de [inicio, fim], com o tempo ja deslocado pra comecar em 0. */
export function palavrasDoTrecho(t: Transcricao, inicio: number, fim: number): Palavra[] {
  const out: Palavra[] = [];
  for (const s of t.segmentos) {
    s.p.forEach((p, k) => {
      if (p.f <= inicio || p.i >= fim) return;
      out.push({ i: Math.max(0, p.i - inicio), f: Math.min(fim, p.f) - inicio, w: p.w, quebra: k === s.p.length - 1 });
    });
  }
  return out;
}
