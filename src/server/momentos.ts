import { z } from "zod";
import * as repo from "./db/repo.ts";

/*
 * Contrato entre o Claude (skill sk-cortes) e o painel. O Claude grava um JSON com
 * esta forma e o CLI importa. Validacao estrita: erro aqui volta pro Claude com a
 * mensagem exata do que corrigir, em vez de sujar o banco.
 */

const semTravessao = (campo: string) => (s: string | undefined | null) =>
  !s || !/[—–]/.test(s) || `${campo} tem travessao; troque por virgula, ponto ou parenteses`;

const texto = (campo: string) =>
  z.string().trim().optional().nullable().superRefine((s, ctx) => {
    const r = semTravessao(campo)(s);
    if (r !== true) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r });
  });

export const Frase = z.object({ inicio: z.number().min(0), fim: z.number().min(0), texto: z.string().min(1) });

const RectZ = z.object({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1), h: z.number().gt(0).max(1),
});

/** O que o editor (ou o Claude, olhando um quadro do video) define sobre o enquadramento. */
export const EdicaoZ = z.object({
  cam: RectZ.nullable().optional(),
  jogo: RectZ.nullable().optional(),
  camPos: z.enum(["cima", "baixo"]).optional(),
  camFracao: z.number().min(0.2).max(0.55).optional(),
  zoom: z.number().min(1).max(2.2).optional(),
  ganchoSegundos: z.number().min(0).max(60).optional(),
  semLegenda: z.boolean().optional(),
  tapar: RectZ.nullable().optional(),
  estilo: z.object({
    tamanho: z.number().min(0.7).max(1.5).optional(),
    cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    fonte: z.enum(["Arial Black", "Impact", "Bahnschrift"]).optional(),
    deslocar: z.number().min(-500).max(500).optional(),
    maiusculas: z.boolean().optional(),
  }).optional(),
});

const Momento = z.object({
  video_id: z.number().int(),
  inicio: z.number().min(0),
  fim: z.number().min(0),
  nota: z.number().int().min(0).max(10).default(5),
  gancho: z.string().trim().min(3).max(90),
  titulo: texto("titulo"),
  legenda_reels: texto("legenda_reels"),
  legenda_tiktok: texto("legenda_tiktok"),
  hashtags: z.string().optional().nullable(),
  legendas: z.array(Frase).optional().nullable(),
  layout: z.enum(["desfocado", "facecam", "cheio"]).default("desfocado"),
  edicao: EdicaoZ.optional().nullable(),
  porque: z.string().optional().nullable(),
}).superRefine((m, ctx) => {
  const d = m.fim - m.inicio;
  if (d < 3 || d > 180) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duracao ${d.toFixed(1)} s fora de 3 a 180 s` });
  const r = semTravessao("gancho")(m.gancho);
  if (r !== true) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r });
  for (const f of m.legendas ?? []) {
    const rf = semTravessao("legendas")(f.texto);
    if (rf !== true) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: rf }); break; }
  }
});

const Descarte = z.object({ video_id: z.number().int(), descartar: z.literal(true), porque: z.string().optional() });

export interface ResultadoImport {
  inseridos: number[];
  descartados: number[];
  erros: string[];
}

export function importarMomentos(bruto: unknown): ResultadoImport {
  const lista = Array.isArray(bruto) ? bruto : [bruto];
  const res: ResultadoImport = { inseridos: [], descartados: [], erros: [] };
  const analisados = new Set<number>();

  lista.forEach((item, k) => {
    // Escolhe o schema na mao: union do zod devolve "Invalid input" sem dizer o que falta.
    const ehDescarte = !!item && typeof item === "object" && (item as { descartar?: unknown }).descartar === true;
    const p = (ehDescarte ? Descarte : Momento).safeParse(item);
    if (!p.success) {
      res.erros.push(`item ${k}: ${p.error.issues.map((i) => `${i.path.join(".") || "item"}: ${i.message}`).join("; ")}`);
      return;
    }
    const d = p.data;
    const v = repo.getVideo(d.video_id);
    if (!v) { res.erros.push(`item ${k}: video ${d.video_id} nao existe`); return; }

    if ("descartar" in d) {
      repo.editarVideo(v.id, { status: "analisado", erro: d.porque ? `sem momento: ${d.porque}` : null });
      res.descartados.push(v.id);
      return;
    }

    const fonte = v.fonteId ? repo.getFonte(v.fonteId) : undefined;
    if (fonte?.libera === "nao") {
      res.erros.push(`item ${k}: ${fonte.nome} esta marcado como "nao libera cortes"`);
      return;
    }
    if (v.duracao && d.fim > v.duracao + 0.5) {
      res.erros.push(`item ${k}: fim ${d.fim} passa da duracao do video (${v.duracao.toFixed(1)} s)`);
      return;
    }

    const m = repo.inserirMomento({
      videoId: v.id, inicio: d.inicio, fim: d.fim, nota: d.nota, gancho: d.gancho,
      titulo: d.titulo ?? null, legendaReels: d.legenda_reels ?? null, legendaTiktok: d.legenda_tiktok ?? null,
      hashtags: d.hashtags ?? null, legendas: d.legendas ?? null, layout: d.layout, porque: d.porque ?? null,
      edicao: d.edicao ?? null,
    });
    res.inseridos.push(m.id);
    analisados.add(v.id);
  });

  for (const id of analisados) repo.editarVideo(id, { status: "analisado" });
  return res;
}
