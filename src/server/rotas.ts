import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as repo from "./db/repo.ts";
import { listarEstudos, lerRegras, salvarRegras } from "./caderno.ts";
import { jobBaixar, jobBuscar, jobTranscrever } from "./jobs/tarefas.ts";
import { cancelar, listJobs } from "./jobs/runner.ts";
import { jobCompilacao, jobCurto, jobDica } from "./fabrica/render.ts";
import { plataformaDaUrl, segundos } from "./ferramentas/ytdlp.ts";
import { config } from "./config.ts";
import { EdicaoZ, Frase } from "./momentos.ts";
import { lerTranscricao } from "./ferramentas/midia.ts";
import { rodarOk } from "./ferramentas/processo.ts";
import { join } from "node:path";

const Id = z.object({ id: z.coerce.number().int() });

const Facecam = z.object({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1), h: z.number().gt(0).max(1),
}).nullable();

const FonteIn = z.object({
  nome: z.string().trim().min(1),
  url: z.string().trim().url(),
  idioma: z.string().trim().min(2).default("pt"),
  origem: z.enum(["br", "gringo"]).default("br"),
  libera: z.enum(["sim", "nao", "?"]).default("?"),
  facecam: Facecam.optional(),
  notas: z.string().nullable().optional(),
});

/** Caminho do disco vira URL servida em /midia, pro painel tocar o video. */
export function urlMidia(arquivo: string | null): string | null {
  if (!arquivo) return null;
  const rel = arquivo.slice(config.dados.length).replace(/\\/g, "/").replace(/^\/+/, "");
  return `/midia/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

export async function rotas(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((err: Error, _req, reply) => {
    const status = err instanceof z.ZodError ? 400 : (err as { statusCode?: number }).statusCode ?? 400;
    const msg = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : err.message;
    reply.code(status).send({ erro: msg });
  });

  app.get("/api/estado", async () => ({ contagens: repo.contagens(), jobs: listJobs(15), ajustes: repo.ajustes() }));
  app.post("/api/jobs/:id/cancelar", async (req) => ({ ok: cancelar(Id.parse(req.params).id) }));

  /* --------------------------------------------------------------- fontes */
  app.get("/api/fontes", async () => repo.listarFontes());
  app.post("/api/fontes", async (req) => {
    const f = FonteIn.parse(req.body);
    return repo.criarFonte({ ...f, plataforma: plataformaDaUrl(f.url), facecam: f.facecam ?? null, notas: f.notas ?? null });
  });
  app.patch("/api/fontes/:id", async (req) => {
    const { id } = Id.parse(req.params);
    const f = FonteIn.partial().parse(req.body);
    repo.editarFonte(id, { ...f, ...(f.url ? { plataforma: plataformaDaUrl(f.url) } : {}) } as Partial<repo.Fonte>);
    return repo.getFonte(id);
  });
  app.delete("/api/fontes/:id", async (req) => { repo.apagarFonte(Id.parse(req.params).id); return { ok: true }; });
  app.post("/api/fontes/:id/buscar", async (req) => jobBuscar(Id.parse(req.params).id));

  /* --------------------------------------------------------------- videos */
  app.get("/api/videos", async (req) => {
    const q = z.object({ tipo: z.string().optional(), status: z.string().optional() }).parse(req.query);
    return repo.listarVideos({ tipo: q.tipo, status: q.status?.split(",").filter(Boolean) })
      .map((v) => ({ ...v, midia: urlMidia(v.arquivo) }));
  });

  /** Link avulso. `de`/`ate` opcionais baixam so um trecho de live longa. */
  app.post("/api/videos", async (req) => {
    const b = z.object({
      url: z.string().trim().url(),
      tipo: z.enum(["corte", "estudo"]).default("corte"),
      fonteId: z.number().int().nullable().optional(),
      de: z.string().optional(),
      ate: z.string().optional(),
    }).parse(req.body);
    const fonte = b.fonteId ? repo.getFonte(b.fonteId) : undefined;
    const { video } = repo.inserirVideo({
      url: b.url, tipo: b.tipo, fonteId: fonte?.id ?? null, plataforma: plataformaDaUrl(b.url),
      autor: fonte?.nome ?? null, idioma: fonte?.idioma ?? null,
    });
    const trecho: [number, number] | undefined = b.de && b.ate ? [segundos(b.de), segundos(b.ate)] : undefined;
    if (trecho && trecho[1] <= trecho[0]) throw new Error("o fim do trecho tem que vir depois do inicio");
    if (["novo", "erro", "descartado"].includes(video.status)) jobBaixar(video.id, trecho);
    return repo.getVideo(video.id);
  });
  app.post("/api/videos/baixar-novos", async () => {
    const novos = repo.listarVideos({ tipo: "corte", status: ["novo"] });
    for (const v of novos) jobBaixar(v.id);
    return { enfileirados: novos.length };
  });
  /** Procura a webcam do streamer no video (OpenCV). Devolve {cam} ou {cam: null}. */
  app.post("/api/videos/:id/achar-cam", async (req) => {
    const v = repo.getVideo(Id.parse(req.params).id);
    if (!v?.arquivo) throw new Error("video ainda nao foi baixado");
    const s = await rodarOk(config.python, [join(config.workers, "achar_cam.py"), v.arquivo]);
    return JSON.parse(s.stdout.trim().split(/\r?\n/).pop() ?? "{}") as { cam: unknown };
  });
  /**
   * Corte feito na mao: cria um momento em branco (primeiros 30 s) pra ele abrir no
   * editor e marcar tudo sozinho. Funciona mesmo antes da transcricao terminar.
   */
  app.post("/api/videos/:id/corte-manual", async (req) => {
    const v = repo.getVideo(Id.parse(req.params).id);
    if (!v?.arquivo) throw new Error("o video ainda nao foi baixado");
    const cam = repo.camDoStreamer(v.autor, v.fonteId);
    const m = repo.inserirMomento({
      videoId: v.id, inicio: 0, fim: Math.min(30, Math.max(3, v.duracao ?? 30)), nota: 5,
      gancho: "Escreva o gancho aqui", titulo: null, legendaReels: null, legendaTiktok: null,
      hashtags: repo.ajustes().hashtags ?? null, legendas: null, layout: cam ? "facecam" : "desfocado",
      porque: "corte manual", edicao: null,
    });
    if (v.status === "transcrito") repo.editarVideo(v.id, { status: "analisado" });
    return m;
  });
  app.post("/api/videos/:id/baixar", async (req) => { const { id } = Id.parse(req.params); jobBaixar(id); return repo.getVideo(id); });
  app.post("/api/videos/:id/transcrever", async (req) => { const { id } = Id.parse(req.params); jobTranscrever(id); return repo.getVideo(id); });
  app.post("/api/videos/:id/descartar", async (req) => {
    const { id } = Id.parse(req.params);
    repo.editarVideo(id, { status: "descartado" });
    return repo.getVideo(id);
  });

  /* ------------------------------------------------------------- momentos */
  app.get("/api/momentos", async (req) => {
    const q = z.object({ status: z.string().optional() }).parse(req.query);
    return repo.listarMomentos(q.status?.split(",").filter(Boolean)).map((m) => ({
      ...m, midia: urlMidia(m.video.arquivo), camLembrada: repo.camDoStreamer(m.video.autor, m.video.fonteId),
    }));
  });
  app.patch("/api/momentos/:id", async (req) => {
    const { id } = Id.parse(req.params);
    const b = z.object({
      inicio: z.number().min(0).optional(), fim: z.number().min(0).optional(),
      gancho: z.string().trim().min(3).max(90).optional(),
      legendaReels: z.string().nullable().optional(), legendaTiktok: z.string().nullable().optional(),
      hashtags: z.string().nullable().optional(),
      layout: z.enum(["desfocado", "facecam", "cheio"]).optional(),
      edicao: EdicaoZ.nullable().optional(),
      legendas: z.array(Frase).nullable().optional(),
      /** Guarda o recorte da camera pra todos os proximos cortes desse streamer. */
      lembrarCam: z.boolean().optional(),
      status: z.enum(["sugerido", "aprovado", "descartado", "renderizado"]).optional(),
    }).parse(req.body);
    if (b.inicio !== undefined && b.fim !== undefined && b.fim <= b.inicio) throw new Error("o fim tem que vir depois do inicio");
    for (const t of [b.gancho, ...(b.legendas ?? []).map((f) => f.texto)]) {
      if (t && /[\u2014\u2013]/.test(t)) throw new Error("tem travessao no texto; troque por virgula, ponto ou parenteses");
    }
    const { lembrarCam, ...campos } = b;
    repo.editarMomento(id, campos);
    const m = repo.getMomento(id);
    if (lembrarCam && m?.edicao?.cam) {
      const autor = repo.getVideo(m.videoId)?.autor;
      if (autor) repo.lembrarCam(autor, m.edicao.cam);
    }
    return m;
  });

  /**
   * Falas do video em volta do corte, pro editor mostrar e deixar corrigir. Vem das
   * legendas ja editadas/traduzidas; onde elas nao cobrem, completa com a transcricao.
   */
  app.get("/api/momentos/:id/frases", async (req) => {
    const m = repo.getMomento(Id.parse(req.params).id);
    if (!m) throw new Error("momento nao existe");
    const v = repo.getVideo(m.videoId);
    const de = Math.max(0, m.inicio - 120);
    const ate = m.fim + 120;
    const editadas = (m.legendas ?? []).map((f) => ({ ...f, origem: "editada" as const }));
    const brutas = v?.transcricao
      ? lerTranscricao(v.transcricao).segmentos.map((s) => ({ inicio: s.i, fim: s.f, texto: s.t, origem: "transcricao" as const }))
      : [];
    const livres = brutas.filter((b) => !editadas.some((e) => e.inicio < b.fim && e.fim > b.inicio));
    return [...editadas, ...livres].filter((f) => f.fim > de && f.inicio < ate).sort((a, b) => a.inicio - b.inicio);
  });

  /* -------------------------------------------------------------- renders */
  app.get("/api/renders", async () => repo.listarRenders().map((r) => ({ ...r, midia: urlMidia(r.arquivo) })));
  app.post("/api/renders", async (req) => {
    const b = z.discriminatedUnion("tipo", [
      z.object({ tipo: z.literal("curto"), momentoId: z.number().int() }),
      z.object({
        tipo: z.literal("compilacao"), momentoIds: z.array(z.number().int()).min(2), gancho: z.string().trim().min(3),
        legendaReels: z.string().nullable().optional(), legendaTiktok: z.string().nullable().optional(),
        hashtags: z.string().nullable().optional(),
      }),
    ]).parse(req.body);
    return b.tipo === "curto" ? jobCurto(b.momentoId).render : jobCompilacao(b.momentoIds, b).render;
  });
  app.post("/api/renders/dica", async (req) => {
    const b = z.object({
      roteiro: z.string().trim().min(20), gancho: z.string().trim().min(3), fundoVideoId: z.number().int(),
      fundoInicio: z.number().min(0).optional(), layout: z.enum(["desfocado", "cheio"]).optional(),
      voz: z.string().optional(), legendaReels: z.string().nullable().optional(),
      legendaTiktok: z.string().nullable().optional(), hashtags: z.string().nullable().optional(),
    }).parse(req.body);
    return jobDica(b).render;
  });
  app.patch("/api/renders/:id", async (req) => {
    const { id } = Id.parse(req.params);
    const b = z.object({
      status: z.enum(["pronto", "postado"]).optional(),
      gancho: z.string().optional(), legendaReels: z.string().nullable().optional(),
      legendaTiktok: z.string().nullable().optional(), hashtags: z.string().nullable().optional(),
      linkReels: z.string().nullable().optional(), linkTiktok: z.string().nullable().optional(),
      viewsReels: z.number().int().min(0).nullable().optional(), viewsTiktok: z.number().int().min(0).nullable().optional(),
    }).parse(req.body);
    const extra = b.status === "postado" && !repo.getRender(id)?.postadoEm ? { postadoEm: new Date().toISOString() } : {};
    repo.editarRender(id, { ...b, ...extra });
    return repo.getRender(id);
  });
  app.delete("/api/renders/:id", async (req) => { repo.apagarRender(Id.parse(req.params).id); return { ok: true }; });

  /* -------------------------------------------------------------- caderno */
  app.get("/api/caderno", async () => ({ regras: lerRegras(), estudos: listarEstudos() }));
  app.put("/api/caderno/regras", async (req) => {
    salvarRegras(z.object({ texto: z.string() }).parse(req.body).texto);
    return { ok: true };
  });

  /* --------------------------------------------------------------- ideias */
  app.get("/api/ideias", async () => repo.listarIdeias());
  app.post("/api/ideias", async (req) => {
    const b = z.object({ titulo: z.string().trim().min(3), descricao: z.string().nullable().optional() }).parse(req.body);
    repo.criarIdeia({ ...b, origem: "painel" });
    return repo.listarIdeias();
  });
  app.patch("/api/ideias/:id", async (req) => {
    const { id } = Id.parse(req.params);
    const b = z.object({
      titulo: z.string().optional(), descricao: z.string().nullable().optional(),
      status: z.enum(["ideia", "testando", "rodando", "descartada"]).optional(),
    }).parse(req.body);
    repo.editarIdeia(id, b);
    return repo.listarIdeias();
  });

  /* -------------------------------------------------------------- ajustes */
  app.put("/api/ajustes", async (req) => {
    const b = z.record(z.enum(["handle", "hashtags", "voz", "cerebro", "estiloLegenda"]), z.string()).parse(req.body);
    for (const [k, v] of Object.entries(b)) repo.salvarAjuste(k, v);
    return repo.ajustes();
  });
}
