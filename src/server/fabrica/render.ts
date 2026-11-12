import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import * as repo from "../db/repo.ts";
import { lerTranscricao, palavrasDoTrecho, sondar, type Palavra } from "../ferramentas/midia.ts";
import { rodarOk } from "../ferramentas/processo.ts";
import { enfileirar, type Contexto, type Job } from "../jobs/runner.ts";
import { frasesParaPalavras, gerarAss } from "./ass.ts";
import { argsFfmpeg, planejar, type Layout } from "./filtros.ts";
import type { Edicao, EstiloLegenda } from "../../compartilhado/geometria.ts";

const FONTES_WINDOWS = ["C:/Windows/Fonts/ariblk.ttf", "C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/impact.ttf", "C:/Windows/Fonts/bahnschrift.ttf"];

/** Estilo salvo como padrao em Ajustes (o editor grava quando ele marca "usar em todos"). */
function estiloPadrao(): EstiloLegenda | null {
  try { return JSON.parse(repo.ajustes().estiloLegenda ?? "null") as EstiloLegenda | null; } catch { return null; }
}

function pastaDoRender(id: number): string {
  const p = join(config.pastas.renders, String(id));
  mkdirSync(join(p, "fontes"), { recursive: true });
  for (const f of FONTES_WINDOWS) {
    const destino = join(p, "fontes", f.split("/").pop()!);
    if (existsSync(f) && !existsSync(destino)) copyFileSync(f, destino);
  }
  return p;
}

function credito(v: repo.Video): string | null {
  if (!v.autor) return null;
  const onde = v.plataforma && v.plataforma !== "outro" ? ` · ${v.plataforma}` : "";
  return `via @${v.autor.replace(/^@/, "")}${onde}`;
}

/** Edicao do momento + a camera lembrada pro streamer quando o momento nao marcou a dele. */
export function edicaoEfetiva(m: repo.Momento, v: repo.Video): Edicao {
  const e = m.edicao ?? {};
  return { ...e, cam: e.cam ?? repo.camDoStreamer(v.autor, v.fonteId) };
}

function palavrasDoMomento(m: repo.Momento, v: repo.Video): Palavra[] {
  if (m.legendas?.length) return frasesParaPalavras(m.legendas, m.inicio, m.fim);
  if (!v.transcricao) return [];
  return palavrasDoTrecho(lerTranscricao(v.transcricao), m.inicio, m.fim);
}

/** Renderiza um momento num mp4 9:16. Usado sozinho (curto) e como parte da compilacao. */
async function renderMomento(
  m: repo.Momento,
  pasta: string,
  nome: string,
  extra: { gancho?: string | null; rotulo?: string | null } = {},
  ctx?: Contexto
): Promise<{ arquivo: string; duracao: number }> {
  const v = repo.getVideo(m.videoId);
  if (!v?.arquivo) throw new Error(`o video do momento ${m.id} nao esta baixado`);
  const sonda = await sondar(v.arquivo);
  const edicao = edicaoEfetiva(m, v);
  // Tela dividida sem camera marcada nao tem o que dividir: cai no desfocado.
  const layout: Layout = m.layout === "facecam" && !edicao.cam ? "desfocado" : m.layout;
  const plano = planejar(layout, sonda.largura, sonda.altura, edicao);
  const duracao = Math.max(0.5, m.fim - m.inicio);

  const ass = gerarAss({
    palavras: edicao.semLegenda ? [] : palavrasDoMomento(m, v),
    estilo: edicao.estilo ?? estiloPadrao(),
    duracao,
    legendaY: plano.legendaY,
    gancho: extra.gancho !== undefined ? extra.gancho : m.gancho,
    ganchoY: plano.ganchoY,
    ganchoAte: plano.ganchoAte ?? undefined,
    rotulo: extra.rotulo ?? null,
    credito: credito(v),
    creditoTopo: plano.creditoTopo,
    marca: repo.ajustes().handle ?? null,
  });
  writeFileSync(join(pasta, "legenda.ass"), ass, "utf8");

  const saida = join(pasta, nome);
  await rodarOk(config.ffmpeg, argsFfmpeg({
    entrada: v.arquivo, inicio: m.inicio, duracao, filtro: plano.filtro, temAudio: sonda.temAudio, saida,
  }), {
    cwd: pasta,
    linha: (l) => {
      const t = l.match(/time=(\d+):(\d+):([\d.]+)/);
      if (t && ctx) {
        const s = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
        ctx.progresso(Math.min(99, Math.round((s / duracao) * 100)), 100, `renderizando ${nome}`);
      }
    },
  });
  return { arquivo: saida, duracao };
}

function finalizar(render: repo.Render, ctx: Contexto, tarefa: () => Promise<{ arquivo: string; duracao: number }>) {
  return (async () => {
    try {
      const r = await tarefa();
      repo.editarRender(render.id, { arquivo: r.arquivo, duracao: r.duracao, status: "pronto", erro: null });
      ctx.progresso(100, 100, "pronto");
      return r;
    } catch (e) {
      repo.editarRender(render.id, { status: "erro", erro: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  })();
}

export function jobCurto(momentoId: number): { job: Job; render: repo.Render } {
  const m = repo.getMomento(momentoId);
  if (!m) throw new Error("momento nao existe");
  const render = repo.criarRender({
    tipo: "curto", momentos: [m.id], gancho: m.gancho, legendaReels: m.legendaReels,
    legendaTiktok: m.legendaTiktok, hashtags: m.hashtags,
  });
  repo.editarMomento(m.id, { status: "renderizado" });
  const job = enfileirar("render", `Render: ${m.gancho}`, (ctx) =>
    finalizar(render, ctx, () => renderMomento(m, pastaDoRender(render.id), "final.mp4", {}, ctx)));
  return { job, render };
}

/**
 * Compilacao "top N": as partes vao do pior pro melhor, o melhor fecha como #1
 * (segura o espectador ate o fim). Precisa passar de 61 s pro TikTok pagar.
 */
export function jobCompilacao(
  momentoIds: number[],
  dados: { gancho: string; legendaReels?: string | null; legendaTiktok?: string | null; hashtags?: string | null }
): { job: Job; render: repo.Render } {
  const momentos = momentoIds.map((id) => repo.getMomento(id)).filter((m): m is repo.Momento => !!m);
  if (momentos.length < 2) throw new Error("compilacao precisa de pelo menos 2 momentos");
  momentos.sort((a, b) => a.nota - b.nota);
  const render = repo.criarRender({
    tipo: "compilacao", momentos: momentos.map((m) => m.id), gancho: dados.gancho,
    legendaReels: dados.legendaReels ?? null, legendaTiktok: dados.legendaTiktok ?? null,
    hashtags: dados.hashtags ?? momentos[0]!.hashtags,
  });
  const job = enfileirar("render", `Compilacao: ${dados.gancho}`, (ctx) =>
    finalizar(render, ctx, async () => {
      const pasta = pastaDoRender(render.id);
      const partes: string[] = [];
      let total = 0;
      for (const [k, m] of momentos.entries()) {
        ctx.progresso(Math.round((k / momentos.length) * 100), 100, `parte ${k + 1} de ${momentos.length}`);
        const r = await renderMomento(m, pasta, `parte${k + 1}.mp4`,
          { gancho: dados.gancho, rotulo: `#${momentos.length - k}` });
        partes.push(`parte${k + 1}.mp4`);
        total += r.duracao;
      }
      writeFileSync(join(pasta, "partes.txt"), partes.map((p) => `file '${p}'`).join("\n"), "utf8");
      await rodarOk(config.ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
        "-i", "partes.txt", "-c", "copy", "-movflags", "+faststart", "final.mp4"], { cwd: pasta });
      return { arquivo: join(pasta, "final.mp4"), duracao: total };
    }));
  return { job, render };
}

export interface DadosDica {
  roteiro: string;
  gancho: string;
  fundoVideoId: number;
  fundoInicio?: number;
  layout?: Layout;
  voz?: string;
  velocidade?: string;
  legendaReels?: string | null;
  legendaTiktok?: string | null;
  hashtags?: string | null;
}

/** Dica narrada: roteiro original + voz edge-tts por cima de gameplay de fundo. */
export function jobDica(d: DadosDica): { job: Job; render: repo.Render } {
  const fundo = repo.getVideo(d.fundoVideoId);
  if (!fundo?.arquivo) throw new Error("o video de fundo precisa estar baixado");
  const render = repo.criarRender({
    tipo: "dica", momentos: [], gancho: d.gancho, legendaReels: d.legendaReels ?? null,
    legendaTiktok: d.legendaTiktok ?? null, hashtags: d.hashtags ?? null,
  });
  const job = enfileirar("render", `Dica: ${d.gancho}`, (ctx) =>
    finalizar(render, ctx, async () => {
      const pasta = pastaDoRender(render.id);
      ctx.progresso(5, 100, "gerando a voz");
      writeFileSync(join(pasta, "roteiro.txt"), d.roteiro, "utf8");
      await rodarOk(config.python, [join(config.workers, "narrar.py"), join(pasta, "roteiro.txt"),
        d.voz || repo.ajustes().voz || "pt-BR-AntonioNeural", join(pasta, "narracao.mp3"),
        join(pasta, "palavras.json"), d.velocidade || "+8%"]);
      const narracao = await sondar(join(pasta, "narracao.mp3"));
      const { palavras } = JSON.parse(readFileSync(join(pasta, "palavras.json"), "utf8")) as { palavras: Palavra[] };
      const sonda = await sondar(fundo.arquivo!);
      const plano = planejar(d.layout ?? "cheio", sonda.largura, sonda.altura);
      const duracao = narracao.duracao + 0.4;
      writeFileSync(join(pasta, "legenda.ass"), gerarAss({
        palavras, duracao, legendaY: plano.legendaY, estilo: estiloPadrao(), gancho: d.gancho, ganchoY: plano.ganchoY,
        ganchoAte: plano.ganchoAte ?? undefined, credito: credito(fundo), marca: repo.ajustes().handle ?? null,
      }), "utf8");
      ctx.progresso(30, 100, "renderizando");
      await rodarOk(config.ffmpeg, argsFfmpeg({
        entrada: fundo.arquivo!, inicio: d.fundoInicio ?? 0, duracao, filtro: plano.filtro,
        temAudio: sonda.temAudio, saida: join(pasta, "final.mp4"), narracao: join(pasta, "narracao.mp3"),
      }), { cwd: pasta });
      return { arquivo: join(pasta, "final.mp4"), duracao };
    }));
  return { job, render };
}
