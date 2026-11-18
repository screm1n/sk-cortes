import { join } from "node:path";
import { config } from "../config.ts";
import * as repo from "../db/repo.ts";
import { baixar, buscarNaFonte, metadados, plataformaDaUrl } from "../ferramentas/ytdlp.ts";
import { sondar, transcrever } from "../ferramentas/midia.ts";
import { enfileirar, type Job } from "./runner.ts";

/** Busca os clips/videos novos de uma fonte e grava como "novo" (ainda sem baixar). */
export function jobBuscar(fonteId: number): Job {
  const fonte = repo.getFonte(fonteId);
  if (!fonte) throw new Error("fonte nao existe");
  return enfileirar("buscar", `Buscar novos: ${fonte.nome}`, async (ctx) => {
    ctx.progresso(0, 1, "listando com yt-dlp");
    const achados = await buscarNaFonte(fonte.url);
    let novos = 0;
    for (const a of achados) {
      const r = repo.inserirVideo({
        url: a.url, fonteId: fonte.id, tipo: "corte", titulo: a.titulo, autor: fonte.nome,
        plataforma: plataformaDaUrl(a.url), duracao: a.duracao, views: a.views,
        publicadoEm: a.publicadoEm, idioma: fonte.idioma,
      });
      if (r.novo) novos++;
    }
    ctx.progresso(1, 1, `${achados.length} encontrados, ${novos} novos`);
    return { encontrados: achados.length, novos };
  });
}

/**
 * Baixa e ja transcreve. Corte baixa video 720p; estudo baixa so o audio (o caderno
 * so precisa do que o cara fala).
 */
export function jobBaixar(videoId: number, trecho?: [number, number]): Job {
  const v = repo.getVideo(videoId);
  if (!v) throw new Error("video nao existe");
  // O trecho fica guardado: "Baixar" de novo (depois de um erro) repete o mesmo pedaco.
  if (trecho) repo.editarVideo(v.id, { trecho });
  else trecho = v.trecho ?? undefined;
  repo.editarVideo(v.id, { status: "baixando", erro: null });
  return enfileirar("baixar", `Baixar e transcrever: ${v.titulo ?? v.url}`, async (ctx) => {
    try {
      if (!v.titulo || !v.autor) {
        ctx.progresso(0, 100, "lendo informacoes do video");
        const m = await metadados(v.url).catch(() => null);
        if (m) repo.editarVideo(v.id, {
          titulo: v.titulo ?? m.titulo, autor: v.autor ?? m.autor, duracao: m.duracao,
          views: v.views ?? m.views, publicadoEm: v.publicadoEm ?? m.publicadoEm,
        });
      }
      const destino = join(config.pastas.videos, String(v.id));
      const arquivo = await baixar(v.url, destino, {
        soAudio: v.tipo === "estudo",
        trecho,
        progresso: (pct, etapa) => ctx.progresso(Math.round(pct / 2), 100, `${etapa} ${pct.toFixed(0)}%`),
      });
      const sonda = await sondar(arquivo);
      repo.editarVideo(v.id, {
        arquivo, status: "baixado", largura: sonda.largura || null, altura: sonda.altura || null,
        duracao: sonda.duracao || null,
      });

      repo.editarVideo(v.id, { status: "transcrevendo" });
      ctx.progresso(50, 100, "transcrevendo (Whisper na CPU, demora)");
      const fonte = v.fonteId ? repo.getFonte(v.fonteId) : undefined;
      const saida = join(config.pastas.transcricoes, `${v.id}.json`);
      const t = await transcrever(arquivo, saida, fonte?.idioma ?? v.idioma, (f) =>
        ctx.progresso(50 + Math.round(f * 50), 100, `transcrevendo ${Math.round(f * 100)}%`));
      repo.editarVideo(v.id, { transcricao: saida, idioma: t.idioma, status: "transcrito" });
      ctx.progresso(100, 100, "pronto pro Claude");
      return { arquivo, segmentos: t.segmentos.length };
    } catch (e) {
      repo.editarVideo(v.id, { status: "erro", erro: explicar(e instanceof Error ? e.message : String(e)) });
      throw e;
    }
  });
}

/** Troca o erro cru do yt-dlp (com URL de 1000 caracteres) por algo que diz o que fazer. */
export function explicar(msg: string): string {
  if (/403|Forbidden|Sign in to confirm|nsig|player/i.test(msg)) {
    return "O site recusou o download (403). Quase sempre e o yt-dlp desatualizado: rode  python -m pip install -U yt-dlp  e clique em Baixar de novo.";
  }
  return msg.replace(/https?:\/\/\S{120,}/g, "(link longo)").slice(0, 600);
}

/** So transcreve de novo (ex.: trocou o idioma da fonte). */
/** `statusFinal` "analisado" = video que ja tem corte (ex.: clip ao vivo), nao deve cair em "esperando os momentos". */
export function jobTranscrever(videoId: number, statusFinal: "transcrito" | "analisado" = "transcrito"): Job {
  const v = repo.getVideo(videoId);
  if (!v?.arquivo) throw new Error("video ainda nao foi baixado");
  repo.editarVideo(v.id, { status: "transcrevendo", erro: null });
  return enfileirar("transcrever", `Transcrever: ${v.titulo ?? v.url}`, async (ctx) => {
    try {
      const fonte = v.fonteId ? repo.getFonte(v.fonteId) : undefined;
      const saida = join(config.pastas.transcricoes, `${v.id}.json`);
      const t = await transcrever(v.arquivo!, saida, fonte?.idioma ?? null, (f) =>
        ctx.progresso(Math.round(f * 100), 100, `transcrevendo ${Math.round(f * 100)}%`));
      repo.editarVideo(v.id, { transcricao: saida, idioma: t.idioma, status: statusFinal });
      return { segmentos: t.segmentos.length };
    } catch (e) {
      repo.editarVideo(v.id, { status: "erro", erro: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  });
}
