/*
 * Ponte entre o Claude (skill sk-cortes) e o painel. Le e escreve o mesmo banco,
 * funciona com ou sem o painel aberto. Saida sempre em JSON ou texto curto, pensado
 * pra gastar pouco token.
 *
 *   npm run cli -- pendentes                 videos transcritos esperando momentos
 *   npm run cli -- transcricao <id> [de] [ate]
 *   npm run cli -- importar <momentos.json>  grava os momentos que o Claude escolheu
 *   npm run cli -- estudos                   videos do caderno esperando analise
 *   npm run cli -- estudo-feito <id> <arquivo.md>
 *   npm run cli -- ideia "<titulo>" "<descricao>"
 *   npm run cli -- baixar <url> [corte|estudo] [de] [ate]   baixa e transcreve agora
 *   npm run cli -- videos                    videos baixados (pra escolher fundo de dica)
 *   npm run cli -- momentos [status]
 *   npm run cli -- render <momentoId>
 *   npm run cli -- compilacao <arquivo.json> {momentoIds, gancho, legendaReels, legendaTiktok, hashtags}
 *   npm run cli -- dica <arquivo.json>       {roteiro, gancho, fundoVideoId, fundoInicio, ...}
 *   npm run cli -- desempenho                o que foi postado e quantas views deu
 *   npm run cli -- quadro <videoId> [seg] [saida.png]   salva um quadro pro Claude ver onde esta a camera
 *   npm run cli -- achar-cam <videoId>       detecta a webcam do streamer (OpenCV)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as repo from "../src/server/db/repo.ts";
import { db } from "../src/server/db/client.ts";
import { importarMomentos } from "../src/server/momentos.ts";
import { lerTranscricao, transcricaoCompacta } from "../src/server/ferramentas/midia.ts";
import { jobBaixar } from "../src/server/jobs/tarefas.ts";
import { jobCompilacao, jobCurto, jobDica } from "../src/server/fabrica/render.ts";
import { getJob, dormir, type Job } from "../src/server/jobs/runner.ts";
import { plataformaDaUrl, segundos } from "../src/server/ferramentas/ytdlp.ts";
import { caminhoRegras } from "../src/server/caderno.ts";
import { config } from "../src/server/config.ts";
import { rodarOk } from "../src/server/ferramentas/processo.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [cmd, ...args] = process.argv.slice(2);
const out = (x: unknown) => console.log(typeof x === "string" ? x : JSON.stringify(x, null, 2));
const lerJson = (p: string) => JSON.parse(readFileSync(resolve(p), "utf8"));

async function esperar(job: Job): Promise<Job> {
  let ultimo = "";
  for (;;) {
    const j = getJob(job.id)!;
    const msg = j.progresso.mensagem;
    if (msg !== ultimo && /\d0%|pronto|transcrevendo$|baixando 100/.test(msg)) { process.stderr.write(`  ${msg}\n`); }
    ultimo = msg;
    if (j.status === "ok" || j.status === "erro" || j.status === "cancelado") return j;
    await dormir(500);
  }
}

function resumoVideo(v: repo.Video) {
  const f = v.fonteId ? repo.getFonte(v.fonteId) : undefined;
  return {
    video_id: v.id, titulo: v.titulo, autor: v.autor, url: v.url, duracao: v.duracao, views: v.views,
    idioma: v.idioma, fonte: f?.nome ?? null, origem: f?.origem ?? null, libera: f?.libera ?? "?",
    facecam: !!f?.facecam,
  };
}

async function main(): Promise<void> {
  db();
  switch (cmd) {
    case "pendentes":
      out({ regras: caminhoRegras(), videos: repo.listarVideos({ tipo: "corte", status: ["transcrito"] }).map(resumoVideo) });
      break;

    case "transcricao": {
      const v = repo.getVideo(Number(args[0]));
      if (!v?.transcricao) throw new Error("video sem transcricao");
      const t = lerTranscricao(v.transcricao);
      out(`# video ${v.id} | ${v.titulo ?? ""} | ${v.autor ?? ""} | idioma ${t.idioma} | ${t.duracao.toFixed(1)} s\n` +
        transcricaoCompacta(t, args[1] ? Number(args[1]) : 0, args[2] ? Number(args[2]) : Infinity));
      break;
    }

    case "importar":
      out(importarMomentos(lerJson(args[0]!)));
      break;

    case "estudos":
      out(repo.listarVideos({ tipo: "estudo", status: ["transcrito"] }).map(resumoVideo));
      break;

    case "estudo-feito":
      repo.editarVideo(Number(args[0]), { analise: resolve(args[1]!), status: "analisado" });
      out({ ok: true });
      break;

    case "ideia":
      repo.criarIdeia({ titulo: args[0]!, descricao: args[1] ?? null, origem: "caderno" });
      out({ ok: true });
      break;

    case "baixar": {
      const url = args[0]!;
      const tipo = (args[1] === "estudo" ? "estudo" : "corte") as "corte" | "estudo";
      const { video } = repo.inserirVideo({ url, tipo, plataforma: plataformaDaUrl(url) });
      const trecho: [number, number] | undefined = args[2] && args[3] ? [segundos(args[2]), segundos(args[3])] : undefined;
      const j = await esperar(jobBaixar(video.id, trecho));
      if (j.status !== "ok") throw new Error(j.erro ?? "falhou");
      out(resumoVideo(repo.getVideo(video.id)!));
      break;
    }

    case "videos":
      out(repo.listarVideos({ status: ["baixado", "transcrito", "analisado"] })
        .filter((v) => v.tipo === "corte")
        .map((v) => ({ video_id: v.id, titulo: v.titulo, autor: v.autor, duracao: v.duracao, status: v.status })));
      break;

    case "momentos":
      out(repo.listarMomentos(args[0] ? args[0].split(",") : undefined).map((m) => ({
        id: m.id, video_id: m.videoId, inicio: m.inicio, fim: m.fim, nota: m.nota, gancho: m.gancho,
        layout: m.layout, status: m.status, autor: m.video.autor,
      })));
      break;

    case "render": {
      const { job, render } = jobCurto(Number(args[0]));
      const j = await esperar(job);
      out({ render: render.id, status: j.status, erro: j.erro, arquivo: repo.getRender(render.id)?.arquivo });
      break;
    }

    case "compilacao": {
      const d = lerJson(args[0]!);
      const { job, render } = jobCompilacao(d.momentoIds, d);
      const j = await esperar(job);
      out({ render: render.id, status: j.status, erro: j.erro, arquivo: repo.getRender(render.id)?.arquivo });
      break;
    }

    case "dica": {
      const { job, render } = jobDica(lerJson(args[0]!));
      const j = await esperar(job);
      out({ render: render.id, status: j.status, erro: j.erro, arquivo: repo.getRender(render.id)?.arquivo });
      break;
    }

    case "quadro": {
      const v = repo.getVideo(Number(args[0]));
      if (!v?.arquivo) throw new Error("video nao baixado");
      const saida = resolve(args[2] ?? join(tmpdir(), `sk-cortes-quadro-${v.id}.png`));
      await rodarOk(config.ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(Number(args[1] ?? 2)),
        "-i", v.arquivo, "-frames:v", "1", "-vf", "scale=960:-2", saida]);
      out({ quadro: saida, largura: v.largura, altura: v.altura, cam_lembrada: repo.camDoStreamer(v.autor, v.fonteId) });
      break;
    }

    case "achar-cam": {
      const v = repo.getVideo(Number(args[0]));
      if (!v?.arquivo) throw new Error("video nao baixado");
      const s = await rodarOk(config.python, [join(config.workers, "achar_cam.py"), v.arquivo]);
      out(s.stdout.trim());
      break;
    }

    case "desempenho":
      out(repo.listarRenders().filter((r) => r.status === "postado").map((r) => ({
        id: r.id, tipo: r.tipo, gancho: r.gancho, duracao: r.duracao, postado_em: r.postadoEm,
        views_reels: r.viewsReels, views_tiktok: r.viewsTiktok,
      })));
      break;

    default:
      out("comandos: pendentes | transcricao | importar | estudos | estudo-feito | ideia | baixar | videos | momentos | render | compilacao | dica | desempenho | quadro | achar-cam");
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`erro: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
