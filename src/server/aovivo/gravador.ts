import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import * as repo from "../db/repo.ts";
import { rodar, rodarOk } from "../ferramentas/processo.ts";
import { sondar } from "../ferramentas/midia.ts";
import { plataformaDaUrl } from "../ferramentas/ytdlp.ts";
import { jobTranscrever } from "../jobs/tarefas.ts";
import { DetectorAudio, DetectorChat } from "./sinais.ts";

/*
 * Grava lives em andamento num "buffer" dos ultimos minutos (pedacos de 4 s em
 * disco) e marca os momentos quentes. Clipar = juntar os pedacos de um intervalo
 * num mp4 e abrir como corte no editor. Tudo em memoria: reiniciou o painel, as
 * gravacoes param (os clipes ja feitos ficam, sao videos normais).
 *
 * "Tempo de gravacao" (t) = segundos desde que a gravacao comecou, somando as
 * reconexoes. E a regua comum de pedacos, marcas e clipes.
 */

export interface Marca {
  id: number;
  t: number;
  tipo: "chat" | "grito" | "manual";
  forca: number;
  detalhe: string;
  em: number;
  status: "nova" | "clipada" | "ignorada";
  momentoId: number | null;
}

interface Pedaco { arquivo: string; ini: number; fim: number }

interface Live {
  id: number;
  url: string;
  canal: string;
  plataforma: string;
  fonteId: number | null;
  pasta: string;
  bufferSeg: number;
  status: "conectando" | "gravando" | "offline" | "parado" | "erro";
  erro: string | null;
  iniciadaEm: number;
  rodada: number;
  offsetRodada: number;
  lidasRodada: number;
  pedacos: Pedaco[];
  ultimoFim: number;
  ultimoFimEm: number;
  marcas: Marca[];
  proc: ChildProcess | null;
  chat: WebSocket | null;
  chatMsgs: number;
  detectorChat: DetectorChat;
  detectorAudio: DetectorAudio;
  fila: Promise<void>;
  timer: NodeJS.Timeout | null;
  religar: NodeJS.Timeout | null;
}

const lives = new Map<number, Live>();
let proximoId = 1;
let proximaMarca = 1;

const PEDACO_S = 4;
/** Reacao do chat chega uns segundos depois do lance. */
const ATRASO_CHAT_S = 4;

export function canalDaLive(url: string): string {
  const m = url.match(/(?:twitch\.tv|kick\.com)\/([A-Za-z0-9_]+)/i);
  if (m) return m[1]!.toLowerCase();
  const y = url.match(/youtube\.com\/(@[^/?#]+)/i);
  return y ? y[1]! : "live";
}

/** Tempo de gravacao "agora" (a ponta da live). */
function agoraT(l: Live, quando = Date.now()): number {
  return l.ultimoFim + Math.max(0, (quando - l.ultimoFimEm) / 1000);
}

function novaMarca(l: Live, t: number, tipo: Marca["tipo"], forca: number, detalhe: string): Marca {
  const m: Marca = { id: proximaMarca++, t: Math.max(0, t), tipo, forca, detalhe, em: Date.now(), status: "nova", momentoId: null };
  l.marcas.unshift(m);
  if (l.marcas.length > 60) l.marcas.pop();
  return m;
}

/* ---------------------------------------------------------------- gravacao */

async function urlDaLive(url: string): Promise<string | null> {
  const s = await rodar(config.ytdlp, ["-g", "-f", "best[height<=720]/best", "--no-warnings", url]);
  if (s.codigo !== 0) return null;
  return s.stdout.trim().split(/\r?\n/)[0] || null;
}

async function ligar(l: Live): Promise<void> {
  if (l.status === "parado") return;
  l.status = l.pedacos.length ? l.status : "conectando";
  const fluxo = await urlDaLive(l.url);
  // Pode ter sido parada enquanto o yt-dlp procurava o fluxo.
  if ((l.status as Live["status"]) === "parado") return;
  if (!fluxo) {
    l.status = "offline";
    l.erro = "A live não está no ar (ou o site recusou). Tento de novo a cada 30 s.";
    l.religar = setTimeout(() => void ligar(l), 30000);
    return;
  }
  l.rodada++;
  l.lidasRodada = 0;
  l.offsetRodada = l.pedacos.length ? agoraT(l) : 0;
  const lista = join(l.pasta, `lista_r${l.rodada}.csv`);
  const proc = spawn(config.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-i", fluxo, "-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy",
    "-f", "segment", "-segment_time", String(PEDACO_S), "-reset_timestamps", "1",
    "-segment_list", lista, "-segment_list_type", "csv", join(l.pasta, `r${l.rodada}_%05d.ts`),
  ], { windowsHide: true });
  let saida = "";
  proc.stderr?.on("data", (d: Buffer) => { saida = (saida + d.toString()).slice(-600); });
  proc.on("close", () => {
    if (l.proc !== proc) return;
    l.proc = null;
    if (l.status === "parado") return;
    l.status = "offline";
    l.erro = saida.trim() ? `A transmissão caiu: ${saida.trim().split(/\r?\n/).pop()}` : "A transmissão terminou ou caiu. Religando em 10 s.";
    l.religar = setTimeout(() => void ligar(l), 10000);
  });
  l.proc = proc;
  l.status = "gravando";
  l.erro = null;
}

function lerPedacos(l: Live): void {
  const lista = join(l.pasta, `lista_r${l.rodada}.csv`);
  if (!l.rodada || !existsSync(lista)) return;
  const linhas = readFileSync(lista, "utf8").trim().split(/\r?\n/).filter(Boolean);
  for (const linha of linhas.slice(l.lidasRodada)) {
    const [nome, ini, fim] = linha.split(",");
    if (!nome || ini === undefined || fim === undefined) continue;
    const p: Pedaco = { arquivo: join(l.pasta, nome), ini: l.offsetRodada + Number(ini), fim: l.offsetRodada + Number(fim) };
    l.pedacos.push(p);
    l.ultimoFim = p.fim;
    l.ultimoFimEm = Date.now();
    // Volume medido em fila (um ffmpeg por vez por live), sem travar a gravacao.
    l.fila = l.fila.then(() => medirVolume(l, p)).catch(() => {});
  }
  l.lidasRodada = linhas.length;

  // Buffer: apaga o que passou do limite.
  const limite = l.ultimoFim - l.bufferSeg;
  while (l.pedacos.length && l.pedacos[0]!.fim < limite) {
    rmSync(l.pedacos.shift()!.arquivo, { force: true });
  }
}

async function medirVolume(l: Live, p: Pedaco): Promise<void> {
  if (!existsSync(p.arquivo)) return;
  const s = await rodar(config.ffmpeg, ["-hide_banner", "-nostats", "-i", p.arquivo, "-vn", "-af", "astats=metadata=0", "-f", "null", "-"]);
  const valores = [...(s.stderr + s.stdout).matchAll(/RMS level dB:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const rms = valores[valores.length - 1];
  if (rms === undefined || !Number.isFinite(rms)) return;
  const pico = l.detectorAudio.registrar(rms, (p.ini + p.fim) / 2);
  if (pico) novaMarca(l, (p.ini + p.fim) / 2, "grito", pico.forca, pico.detalhe);
}

/* -------------------------------------------------------------------- chat */

function ligarChat(l: Live): void {
  if (l.plataforma !== "twitch" || l.status === "parado") return;
  const ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
  l.chat = ws;
  ws.onopen = () => {
    ws.send("PASS SCHMOOPIIE");
    ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 89999)}`);
    ws.send(`JOIN #${l.canal}`);
  };
  ws.onmessage = (e) => {
    for (const linha of String(e.data).split("\r\n")) {
      if (linha.startsWith("PING")) { ws.send("PONG :tmi.twitch.tv"); continue; }
      const m = linha.match(/ PRIVMSG #\w+ :(.*)$/);
      if (m) { l.chatMsgs++; l.detectorChat.registrar(m[1]!, Date.now()); }
    }
  };
  ws.onclose = () => {
    if (l.chat === ws) l.chat = null;
    if (l.status !== "parado") setTimeout(() => { if (!l.chat && l.status !== "parado") ligarChat(l); }, 5000);
  };
  ws.onerror = () => { /* o onclose religa */ };
}

/* ------------------------------------------------------------------ publico */

export function iniciar(url: string, opcoes: { fonteId?: number | null; bufferMin?: number } = {}): Live {
  const ja = [...lives.values()].find((l) => l.url === url && l.status !== "parado");
  if (ja) return ja;
  const id = proximoId++;
  const pasta = join(config.dados, "aovivo", `${id}-${Date.now()}`);
  mkdirSync(pasta, { recursive: true });
  const l: Live = {
    id, url, canal: canalDaLive(url), plataforma: plataformaDaUrl(url), fonteId: opcoes.fonteId ?? null, pasta,
    bufferSeg: Math.round((opcoes.bufferMin ?? 20) * 60), status: "conectando", erro: null, iniciadaEm: Date.now(),
    rodada: 0, offsetRodada: 0, lidasRodada: 0, pedacos: [], ultimoFim: 0, ultimoFimEm: Date.now(), marcas: [],
    proc: null, chat: null, chatMsgs: 0, detectorChat: new DetectorChat(), detectorAudio: new DetectorAudio(),
    fila: Promise.resolve(), timer: null, religar: null,
  };
  lives.set(id, l);
  l.timer = setInterval(() => {
    try { lerPedacos(l); } catch { /* arquivo sendo escrito, tenta no proximo giro */ }
    const pico = l.detectorChat.verificar(Date.now());
    if (pico) novaMarca(l, agoraT(l, pico.em) - ATRASO_CHAT_S, "chat", pico.forca, pico.detalhe);
  }, 2000);
  void ligar(l);
  ligarChat(l);
  return l;
}

export function parar(id: number, apagar = false): void {
  const l = lives.get(id);
  if (!l) return;
  l.status = "parado";
  if (l.religar) clearTimeout(l.religar);
  if (l.timer) clearInterval(l.timer);
  l.proc?.kill();
  l.chat?.close();
  if (apagar) {
    lives.delete(id);
    setTimeout(() => rmSync(l.pasta, { recursive: true, force: true }), 1500);
  }
}

export function marcarAgora(id: number): Marca {
  const l = lives.get(id);
  if (!l) throw new Error("gravação não existe");
  // Quem aperta o botao reage alguns segundos depois do lance.
  return novaMarca(l, agoraT(l) - 3, "manual", 1, "marcado por você");
}

export function ignorar(id: number, marcaId: number): void {
  const m = lives.get(id)?.marcas.find((x) => x.id === marcaId);
  if (m) m.status = "ignorada";
}

export function resumo() {
  return [...lives.values()].map((l) => ({
    id: l.id, url: l.url, canal: l.canal, plataforma: l.plataforma, status: l.status, erro: l.erro,
    iniciadaEm: l.iniciadaEm, gravado: Math.round(l.pedacos.length ? l.ultimoFim - l.pedacos[0]!.ini : 0),
    agora: Math.round(agoraT(l)), bufferSeg: l.bufferSeg, chatMsgs: l.chatMsgs,
    chatAtivo: l.plataforma === "twitch", marcas: l.marcas,
  }));
}

/**
 * Junta os pedacos de [de, ate] (tempo de gravacao) num mp4, cria o video e um
 * corte em cima dele, e manda transcrever pra legenda. Devolve o id do corte.
 */
export async function clipar(id: number, de: number, ate: number, marcaId?: number): Promise<number> {
  const l = lives.get(id);
  if (!l) throw new Error("gravação não existe");
  lerPedacos(l);
  ate = Math.min(ate, l.ultimoFim);
  de = Math.max(de, l.pedacos[0]?.ini ?? 0);
  if (ate - de < 3) throw new Error("ainda não tem gravação suficiente nesse trecho");

  // Folga de um pedaco de cada lado: da pra esticar o corte no editor.
  const usados = l.pedacos.filter((p) => p.fim > de - PEDACO_S && p.ini < ate + PEDACO_S && existsSync(p.arquivo));
  if (!usados.length) throw new Error("esse trecho já saiu do buffer");
  const base = usados[0]!.ini;

  const { video } = repo.inserirVideo({
    url: `${l.url}#ao-vivo-${Date.now()}`, tipo: "corte", fonteId: l.fonteId, autor: l.canal, plataforma: l.plataforma,
    titulo: `Ao vivo: ${l.canal} às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
  });
  const lista = join(l.pasta, `clip_${video.id}.txt`);
  writeFileSync(lista, usados.map((p) => `file '${p.arquivo.replace(/\\/g, "/")}'`).join("\n"), "utf8");
  const arquivo = join(config.pastas.videos, `${video.id}.mp4`);
  await rodarOk(config.ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lista,
    "-c", "copy", "-movflags", "+faststart", arquivo]);
  rmSync(lista, { force: true });

  const sonda = await sondar(arquivo);
  repo.editarVideo(video.id, { arquivo, largura: sonda.largura || null, altura: sonda.altura || null, duracao: sonda.duracao || null, status: "baixado" });

  const marca = marcaId ? l.marcas.find((m) => m.id === marcaId) : undefined;
  const cam = repo.camDoStreamer(l.canal, l.fonteId);
  const m = repo.inserirMomento({
    videoId: video.id, inicio: Math.max(0, de - base), fim: Math.min(sonda.duracao || ate - base, ate - base),
    nota: 5, gancho: "Escreva o gancho aqui", titulo: null, legendaReels: null, legendaTiktok: null,
    hashtags: repo.ajustes().hashtags ?? null, legendas: null, layout: cam ? "facecam" : "desfocado",
    porque: marca ? `clip ao vivo (${marca.tipo}: ${marca.detalhe})` : "clip ao vivo", edicao: null,
  });
  if (marca) { marca.status = "clipada"; marca.momentoId = m.id; }
  // Legenda vem da transcricao, que roda depois sem prender o editor.
  jobTranscrever(video.id, "analisado");
  return m.id;
}

// Painel fechando: nao deixa ffmpeg orfao gravando pra sempre.
for (const sinal of ["exit", "SIGINT", "SIGTERM"] as const) {
  process.once(sinal, () => {
    for (const l of lives.values()) l.proc?.kill();
    if (sinal !== "exit") process.exit(0);
  });
}
