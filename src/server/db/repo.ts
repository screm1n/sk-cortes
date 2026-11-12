import { db } from "./client.ts";
import type { Edicao, Rect } from "../../compartilhado/geometria.ts";

/* Tipos espelham as tabelas, em camelCase. JSON guardado como texto vira objeto aqui. */

export interface Facecam { x: number; y: number; w: number; h: number }

export interface Fonte {
  id: number;
  nome: string;
  plataforma: string;
  url: string;
  idioma: string;
  origem: "br" | "gringo";
  libera: "sim" | "nao" | "?";
  facecam: Facecam | null;
  notas: string | null;
  criadoEm: string;
}

export interface Video {
  id: number;
  fonteId: number | null;
  tipo: "corte" | "estudo";
  url: string;
  titulo: string | null;
  autor: string | null;
  plataforma: string | null;
  duracao: number | null;
  views: number | null;
  publicadoEm: string | null;
  idioma: string | null;
  largura: number | null;
  altura: number | null;
  arquivo: string | null;
  transcricao: string | null;
  analise: string | null;
  /** [de, ate] em segundos quando so um pedaco do video foi baixado. */
  trecho: [number, number] | null;
  status: string;
  erro: string | null;
  criadoEm: string;
}

export interface LegendaFrase { inicio: number; fim: number; texto: string }

export interface Momento {
  id: number;
  videoId: number;
  inicio: number;
  fim: number;
  nota: number;
  gancho: string;
  titulo: string | null;
  legendaReels: string | null;
  legendaTiktok: string | null;
  hashtags: string | null;
  legendas: LegendaFrase[] | null;
  layout: "desfocado" | "facecam" | "cheio";
  edicao: Edicao | null;
  porque: string | null;
  status: string;
  criadoEm: string;
}

export interface Render {
  id: number;
  tipo: "curto" | "compilacao" | "dica";
  momentos: number[];
  arquivo: string | null;
  duracao: number | null;
  gancho: string | null;
  legendaReels: string | null;
  legendaTiktok: string | null;
  hashtags: string | null;
  status: string;
  erro: string | null;
  linkReels: string | null;
  linkTiktok: string | null;
  viewsReels: number | null;
  viewsTiktok: number | null;
  postadoEm: string | null;
  criadoEm: string;
}

export interface Ideia {
  id: number;
  titulo: string;
  descricao: string | null;
  status: string;
  origem: string | null;
  criadoEm: string;
}

type Linha = Record<string, unknown>;

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

function json<T>(v: unknown, padrao: T): T {
  if (typeof v !== "string" || !v) return padrao;
  try { return JSON.parse(v) as T; } catch { return padrao; }
}

function mapear<T>(linha: Linha | undefined, jsons: Record<string, unknown> = {}): T | undefined {
  if (!linha) return undefined;
  const out: Linha = {};
  for (const [k, v] of Object.entries(linha)) {
    const c = camel(k);
    out[c] = c in jsons ? json(v, jsons[c]) : v;
  }
  return out as T;
}

/** UPDATE generico: so as colunas permitidas, objetos viram JSON. */
function atualizar(tabela: string, id: number, campos: Linha, permitidos: string[]): void {
  const pares = Object.entries(campos).filter(([k, v]) => permitidos.includes(k) && v !== undefined);
  if (!pares.length) return;
  const sets = pares.map(([k]) => `${snake(k)} = ?`).join(", ");
  const vals = pares.map(([, v]) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v));
  db().prepare(`UPDATE ${tabela} SET ${sets} WHERE id = ?`).run(...vals, id);
}

/* ------------------------------------------------------------------ fontes */

const FONTE_JSON = { facecam: null };

export function listarFontes(): Fonte[] {
  return (db().prepare("SELECT * FROM fontes ORDER BY nome").all() as Linha[])
    .map((l) => mapear<Fonte>(l, FONTE_JSON)!);
}

export function getFonte(id: number): Fonte | undefined {
  return mapear<Fonte>(db().prepare("SELECT * FROM fontes WHERE id = ?").get(id) as Linha, FONTE_JSON);
}

export function criarFonte(f: Omit<Fonte, "id" | "criadoEm">): Fonte {
  const r = db().prepare(
    `INSERT INTO fontes (nome, plataforma, url, idioma, origem, libera, facecam, notas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(f.nome, f.plataforma, f.url, f.idioma, f.origem, f.libera,
    f.facecam ? JSON.stringify(f.facecam) : null, f.notas);
  return getFonte(Number(r.lastInsertRowid))!;
}

export function editarFonte(id: number, campos: Partial<Fonte>): void {
  atualizar("fontes", id, campos as Linha,
    ["nome", "plataforma", "url", "idioma", "origem", "libera", "facecam", "notas"]);
}

export function apagarFonte(id: number): void {
  db().prepare("DELETE FROM fontes WHERE id = ?").run(id);
}

/* ------------------------------------------------------------------ videos */

const VIDEO_JSON = { trecho: null };

export function listarVideos(filtro: { tipo?: string; status?: string[] } = {}): Video[] {
  const onde: string[] = [];
  const args: unknown[] = [];
  if (filtro.tipo) { onde.push("tipo = ?"); args.push(filtro.tipo); }
  if (filtro.status?.length) {
    onde.push(`status IN (${filtro.status.map(() => "?").join(",")})`);
    args.push(...filtro.status);
  }
  const sql = `SELECT * FROM videos ${onde.length ? "WHERE " + onde.join(" AND ") : ""}
               ORDER BY id DESC LIMIT 300`;
  return (db().prepare(sql).all(...args) as Linha[]).map((l) => mapear<Video>(l, VIDEO_JSON)!);
}

export function getVideo(id: number): Video | undefined {
  return mapear<Video>(db().prepare("SELECT * FROM videos WHERE id = ?").get(id) as Linha, VIDEO_JSON);
}

/** Insere se a URL for nova. Devolve o video (novo ou o que ja existia). */
export function inserirVideo(v: Partial<Video> & { url: string }): { video: Video; novo: boolean } {
  const existe = db().prepare("SELECT id FROM videos WHERE url = ?").get(v.url) as { id: number } | undefined;
  if (existe) return { video: getVideo(existe.id)!, novo: false };
  const r = db().prepare(
    `INSERT INTO videos (fonte_id, tipo, url, titulo, autor, plataforma, duracao, views, publicado_em, idioma)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(v.fonteId ?? null, v.tipo ?? "corte", v.url, v.titulo ?? null, v.autor ?? null,
    v.plataforma ?? null, v.duracao ?? null, v.views ?? null, v.publicadoEm ?? null, v.idioma ?? null);
  return { video: getVideo(Number(r.lastInsertRowid))!, novo: true };
}

export function editarVideo(id: number, campos: Partial<Video>): void {
  atualizar("videos", id, campos as Linha, ["titulo", "autor", "plataforma", "duracao", "views",
    "publicadoEm", "idioma", "largura", "altura", "arquivo", "transcricao", "analise", "trecho", "status", "erro", "tipo"]);
}

/* ---------------------------------------------------------------- momentos */

const MOMENTO_JSON = { legendas: null, edicao: null };

export interface MomentoComVideo extends Momento {
  video: Pick<Video, "titulo" | "autor" | "url" | "arquivo" | "plataforma" | "largura" | "altura" | "duracao" | "fonteId">;
}

export function listarMomentos(status?: string[]): MomentoComVideo[] {
  const onde = status?.length ? `WHERE m.status IN (${status.map(() => "?").join(",")})` : "";
  const linhas = db().prepare(
    `SELECT m.*, v.titulo AS v_titulo, v.autor AS v_autor, v.url AS v_url, v.arquivo AS v_arquivo,
            v.plataforma AS v_plataforma, v.largura AS v_largura, v.altura AS v_altura,
            v.duracao AS v_duracao, v.fonte_id AS v_fonte_id
     FROM momentos m JOIN videos v ON v.id = m.video_id ${onde}
     ORDER BY m.status = 'sugerido' DESC, m.nota DESC, m.id DESC LIMIT 300`
  ).all(...(status ?? [])) as Linha[];
  return linhas.map((l) => {
    const m = mapear<Momento>(
      Object.fromEntries(Object.entries(l).filter(([k]) => !k.startsWith("v_"))), MOMENTO_JSON)!;
    return {
      ...m,
      video: {
        titulo: l.v_titulo as string, autor: l.v_autor as string, url: l.v_url as string,
        arquivo: l.v_arquivo as string, plataforma: l.v_plataforma as string,
        largura: l.v_largura as number, altura: l.v_altura as number,
        duracao: l.v_duracao as number, fonteId: l.v_fonte_id as number | null,
      },
    };
  });
}

export function getMomento(id: number): Momento | undefined {
  return mapear<Momento>(db().prepare("SELECT * FROM momentos WHERE id = ?").get(id) as Linha, MOMENTO_JSON);
}

export function inserirMomento(m: Omit<Momento, "id" | "criadoEm" | "status" | "edicao"> & { edicao?: Edicao | null }): Momento {
  const r = db().prepare(
    `INSERT INTO momentos (video_id, inicio, fim, nota, gancho, titulo, legenda_reels, legenda_tiktok,
       hashtags, legendas, layout, porque, edicao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(m.videoId, m.inicio, m.fim, m.nota, m.gancho, m.titulo, m.legendaReels, m.legendaTiktok,
    m.hashtags, m.legendas ? JSON.stringify(m.legendas) : null, m.layout, m.porque,
    m.edicao ? JSON.stringify(m.edicao) : null);
  return getMomento(Number(r.lastInsertRowid))!;
}

export function editarMomento(id: number, campos: Partial<Momento>): void {
  atualizar("momentos", id, campos as Linha, ["inicio", "fim", "nota", "gancho", "titulo",
    "legendaReels", "legendaTiktok", "hashtags", "legendas", "layout", "edicao", "porque", "status"]);
}

/* ----------------------------------------------------------------- renders */

const RENDER_JSON = { momentos: [] };

export function listarRenders(): Render[] {
  return (db().prepare("SELECT * FROM renders ORDER BY id DESC LIMIT 200").all() as Linha[])
    .map((l) => mapear<Render>(l, RENDER_JSON)!);
}

export function getRender(id: number): Render | undefined {
  return mapear<Render>(db().prepare("SELECT * FROM renders WHERE id = ?").get(id) as Linha, RENDER_JSON);
}

export function criarRender(r: Pick<Render, "tipo" | "momentos" | "gancho" | "legendaReels" | "legendaTiktok" | "hashtags">): Render {
  const res = db().prepare(
    `INSERT INTO renders (tipo, momentos, gancho, legenda_reels, legenda_tiktok, hashtags)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(r.tipo, JSON.stringify(r.momentos), r.gancho, r.legendaReels, r.legendaTiktok, r.hashtags);
  return getRender(Number(res.lastInsertRowid))!;
}

export function editarRender(id: number, campos: Partial<Render>): void {
  atualizar("renders", id, campos as Linha, ["arquivo", "duracao", "gancho", "legendaReels",
    "legendaTiktok", "hashtags", "status", "erro", "linkReels", "linkTiktok", "viewsReels",
    "viewsTiktok", "postadoEm"]);
}

export function apagarRender(id: number): void {
  db().prepare("DELETE FROM renders WHERE id = ?").run(id);
}

/* ------------------------------------------------------------------ ideias */

export function listarIdeias(): Ideia[] {
  return (db().prepare(
    `SELECT * FROM ideias ORDER BY CASE status WHEN 'rodando' THEN 0 WHEN 'testando' THEN 1
       WHEN 'ideia' THEN 2 ELSE 3 END, id`
  ).all() as Linha[]).map((l) => mapear<Ideia>(l)!);
}

export function criarIdeia(i: { titulo: string; descricao?: string | null; status?: string; origem?: string | null }): void {
  db().prepare(
    `INSERT INTO ideias (titulo, descricao, status, origem) VALUES (?, ?, ?, ?)
     ON CONFLICT(titulo) DO UPDATE SET descricao = excluded.descricao, origem = excluded.origem`
  ).run(i.titulo, i.descricao ?? null, i.status ?? "ideia", i.origem ?? null);
}

export function editarIdeia(id: number, campos: Partial<Ideia>): void {
  atualizar("ideias", id, campos as Linha, ["titulo", "descricao", "status", "origem"]);
}

/* ----------------------------------------------------------------- ajustes */

export function ajustes(): Record<string, string> {
  const linhas = db().prepare("SELECT chave, valor FROM ajustes WHERE chave NOT LIKE 'cam:%'").all() as { chave: string; valor: string }[];
  return Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
}

export function salvarAjuste(chave: string, valor: string): void {
  db().prepare(
    "INSERT INTO ajustes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor"
  ).run(chave, valor);
}

/* ---------------------------------------------------------- camera padrao */

const chaveCam = (autor: string) => `cam:${autor.replace(/^@/, "").toLowerCase()}`;

/** Recorte da camera lembrado pra um streamer (marcado uma vez no editor, vale pros proximos). */
export function camDoStreamer(autor: string | null, fonteId?: number | null): Rect | null {
  if (autor) {
    const l = db().prepare("SELECT valor FROM ajustes WHERE chave = ?").get(chaveCam(autor)) as { valor: string } | undefined;
    const salvo = json<Rect | null>(l?.valor, null);
    if (salvo) return salvo;
  }
  return (fonteId ? getFonte(fonteId)?.facecam : null) ?? null;
}

export function lembrarCam(autor: string, cam: Rect): void {
  salvarAjuste(chaveCam(autor), JSON.stringify(cam));
}

export function contagens() {
  const q = (sql: string) => (db().prepare(sql).get() as { n: number }).n;
  return {
    fontes: q("SELECT COUNT(*) n FROM fontes"),
    radar: q("SELECT COUNT(*) n FROM videos WHERE tipo = 'corte' AND status NOT IN ('descartado')"),
    novos: q("SELECT COUNT(*) n FROM videos WHERE tipo = 'corte' AND status = 'novo'"),
    andando: q("SELECT COUNT(*) n FROM videos WHERE status IN ('baixando', 'baixado', 'transcrevendo')"),
    postados: q("SELECT COUNT(*) n FROM renders WHERE status = 'postado'"),
    prontos: q("SELECT COUNT(*) n FROM renders WHERE status = 'pronto'"),
    aguardandoClaude: q("SELECT COUNT(*) n FROM videos WHERE status = 'transcrito'"),
    momentos: q("SELECT COUNT(*) n FROM momentos WHERE status = 'sugerido'"),
    fila: q("SELECT COUNT(*) n FROM renders WHERE status IN ('pronto', 'renderizando')"),
    estudos: q("SELECT COUNT(*) n FROM videos WHERE tipo = 'estudo'"),
  };
}
