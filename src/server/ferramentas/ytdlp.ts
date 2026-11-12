import { readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "../config.ts";
import { rodarOk } from "./processo.ts";

export type Plataforma = "twitch" | "youtube" | "kick" | "tiktok" | "instagram" | "outro";

/** Canal dono do clip/video quando a URL entrega isso (twitch.tv/<canal>/clip/..., kick.com/<canal>/clips/...). */
export function canalDaUrl(url: string): string | null {
  const m = url.match(/(?:twitch\.tv|kick\.com)\/([A-Za-z0-9_]+)\/(?:clip|clips|videos?)\b/i);
  return m ? m[1]!.toLowerCase() : null;
}

export function plataformaDaUrl(url: string): Plataforma {
  const u = url.toLowerCase();
  if (u.includes("twitch.tv")) return "twitch";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("kick.com")) return "kick";
  if (u.includes("tiktok.com")) return "tiktok";
  if (u.includes("instagram.com")) return "instagram";
  return "outro";
}

/**
 * Onde procurar material novo de uma fonte. Na Twitch sao os clips mais vistos da
 * semana: o proprio publico ja escolheu o momento viral, entao nao precisa
 * transcrever live de 6 horas. URL que ja aponta pra uma pagina especifica fica como esta.
 */
export function urlDeBusca(url: string): string {
  const limpa = url.trim().replace(/\/+$/, "");
  const p = plataformaDaUrl(limpa);
  if (p === "twitch") {
    const m = limpa.match(/twitch\.tv\/([A-Za-z0-9_]+)$/);
    if (m) return `https://www.twitch.tv/${m[1]}/clips?filter=clips&range=7d`;
  }
  if (p === "youtube") {
    const m = limpa.match(/youtube\.com\/(@[^/?#]+|channel\/[^/?#]+|c\/[^/?#]+)$/);
    if (m) return `https://www.youtube.com/${m[1]}/videos`;
  }
  return limpa;
}

export interface Achado {
  url: string;
  titulo: string | null;
  duracao: number | null;
  views: number | null;
  publicadoEm: string | null;
}

/** Le a saida de `yt-dlp --flat-playlist -J`. */
export function lerPlaylist(json: string): Achado[] {
  const dados = JSON.parse(json) as { entries?: Record<string, unknown>[] };
  const itens = dados.entries ?? [dados as Record<string, unknown>];
  return itens
    .map((e): Achado | null => {
      const url = (e.webpage_url ?? e.url ?? e.original_url) as string | undefined;
      if (!url || !/^https?:/.test(url)) return null;
      return {
        url,
        titulo: (e.title as string | undefined) ?? null,
        duracao: typeof e.duration === "number" ? e.duration : null,
        views: typeof e.view_count === "number" ? e.view_count : null,
        publicadoEm: dataDe(e),
      };
    })
    .filter((x): x is Achado => x !== null);
}

function dataDe(e: Record<string, unknown>): string | null {
  if (typeof e.timestamp === "number") return new Date(e.timestamp * 1000).toISOString();
  if (typeof e.upload_date === "string" && /^\d{8}$/.test(e.upload_date)) {
    const d = e.upload_date;
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }
  return null;
}

export async function buscarNaFonte(url: string, limite = 30): Promise<Achado[]> {
  const s = await rodarOk(config.ytdlp, [
    "--flat-playlist", "-J", "--playlist-end", String(limite), "--no-warnings", urlDeBusca(url),
  ]);
  return lerPlaylist(s.stdout);
}

export interface Meta {
  titulo: string | null;
  autor: string | null;
  duracao: number | null;
  views: number | null;
  publicadoEm: string | null;
}

export async function metadados(url: string): Promise<Meta> {
  const s = await rodarOk(config.ytdlp, ["-J", "--no-playlist", "--no-warnings", url]);
  const e = JSON.parse(s.stdout) as Record<string, unknown>;
  return {
    titulo: (e.title as string) ?? null,
    // Em clip da Twitch o "uploader" e quem clipou, nao o streamer: o canal vem da URL.
    autor: canalDaUrl(url) ?? ((e.uploader ?? e.channel ?? e.creator) as string | undefined) ?? null,
    duracao: typeof e.duration === "number" ? e.duration : null,
    views: typeof e.view_count === "number" ? e.view_count : null,
    publicadoEm: dataDe(e),
  };
}

/** Converte "1:02:03", "62:03" ou "3723" em segundos. */
export function segundos(txt: string): number {
  const partes = txt.trim().split(":").map(Number);
  if (partes.some((n) => !Number.isFinite(n))) throw new Error(`tempo invalido: ${txt}`);
  return partes.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * No YouTube o corte de trecho do proprio yt-dlp (--download-sections) passa pelo
 * ffmpeg lendo direto do servidor deles, e o YouTube estrangula esse acesso ate
 * travar (ou responde 403). O baixador normal pega o video inteiro em segundos,
 * entao la a gente baixa tudo e corta o trecho no PC. Twitch e Kick servem em HLS
 * e uma live tem horas: neles o trecho continua vindo direto.
 */
export function cortaLocal(url: string): boolean {
  return plataformaDaUrl(url) === "youtube";
}

export function argsDownload(url: string, destinoSemExt: string, opcoes: { soAudio?: boolean; trecho?: [number, number] }): string[] {
  const args = [
    "--no-playlist", "--no-warnings", "--newline",
    "--ffmpeg-location", dirname(config.ffmpeg),
    "-o", `${destinoSemExt}.%(ext)s`,
  ];
  if (opcoes.soAudio) {
    args.push("-f", "ba[ext=m4a]/ba/b");
  } else {
    // 720p basta pra 1080x1920. H.264 (avc1) primeiro: o navegador do editor e o
    // ffmpeg lidam melhor com ele do que com AV1.
    args.push(
      "-f", "bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]/b",
      "--merge-output-format", "mp4",
    );
  }
  if (opcoes.trecho && !cortaLocal(url)) {
    args.push("--download-sections", `*${opcoes.trecho[0]}-${opcoes.trecho[1]}`, "--force-keyframes-at-cuts");
  }
  args.push(url);
  return args;
}

function arquivoBaixado(destinoSemExt: string): string {
  const pasta = dirname(destinoSemExt);
  const base = destinoSemExt.slice(pasta.length + 1);
  const arq = readdirSync(pasta).find((f) => f.startsWith(base + ".") && !f.endsWith(".part") && !f.endsWith(".ytdl"));
  if (!arq) throw new Error("o yt-dlp terminou mas o arquivo nao apareceu");
  return join(pasta, arq);
}

/** Argumentos do corte local: copia direta (sem reencode), comeca no quadro-chave antes do inicio. */
export function argsCorteLocal(entrada: string, saida: string, trecho: [number, number]): string[] {
  return ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(trecho[0]), "-i", entrada,
    "-t", String(trecho[1] - trecho[0]), "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", saida];
}

export async function baixar(
  url: string,
  destinoSemExt: string,
  opcoes: { soAudio?: boolean; trecho?: [number, number]; progresso?: (pct: number, etapa: string) => void } = {}
): Promise<string> {
  const local = !!opcoes.trecho && cortaLocal(url);
  // O video inteiro vai pra um nome provisorio: se algo falhar no meio, nao fica
  // um arquivo de 1 GB fingindo ser o trecho.
  const alvo = local ? `${destinoSemExt}-inteiro` : destinoSemExt;
  // Video e audio vem em dois downloads seguidos; a barra soma os dois.
  let passada = 0;
  let ultimo = 0;
  await rodarOk(config.ytdlp, argsDownload(url, alvo, opcoes), {
    linha: (l) => {
      const m = l.match(/\[download\]\s+([\d.]+)%/);
      if (!m || !opcoes.progresso) return;
      const pct = Number(m[1]);
      if (pct < ultimo - 50) passada = 1;
      ultimo = pct;
      opcoes.progresso(opcoes.soAudio ? pct : passada === 0 ? pct * 0.9 : 90 + pct * 0.1, local ? "baixando o video inteiro" : "baixando");
    },
  });
  const baixado = arquivoBaixado(alvo);
  if (!local) return baixado;

  opcoes.progresso?.(100, "cortando o trecho");
  const saida = `${destinoSemExt}.${baixado.split(".").pop()}`;
  try {
    await rodarOk(config.ffmpeg, argsCorteLocal(baixado, saida, opcoes.trecho!));
  } finally {
    rmSync(baixado, { force: true });
  }
  return saida;
}
