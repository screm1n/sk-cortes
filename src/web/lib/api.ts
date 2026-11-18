import type { Edicao, Layout, Rect } from "../../compartilhado/geometria.ts";

export type { Edicao, Layout, Rect };

export interface Fonte {
  id: number; nome: string; plataforma: string; url: string; idioma: string;
  origem: "br" | "gringo"; libera: "sim" | "nao" | "?"; notas: string | null;
}

export interface Video {
  id: number; fonteId: number | null; tipo: "corte" | "estudo"; url: string; titulo: string | null;
  autor: string | null; plataforma: string | null; duracao: number | null; views: number | null;
  publicadoEm: string | null; idioma: string | null; status: string; erro: string | null;
  midia: string | null; criadoEm: string;
}

export interface Frase { inicio: number; fim: number; texto: string; origem?: "editada" | "transcricao" }

export interface Momento {
  id: number; videoId: number; inicio: number; fim: number; nota: number; gancho: string;
  titulo: string | null; legendaReels: string | null; legendaTiktok: string | null; hashtags: string | null;
  legendas: Frase[] | null; layout: Layout; edicao: Edicao | null; porque: string | null; status: string;
  video: { titulo: string | null; autor: string | null; url: string; plataforma: string | null; largura: number | null; altura: number | null; duracao: number | null };
  midia: string | null;
  camLembrada: Rect | null;
}

export interface Render {
  id: number; tipo: "curto" | "compilacao" | "dica"; momentos: number[]; duracao: number | null;
  gancho: string | null; legendaReels: string | null; legendaTiktok: string | null; hashtags: string | null;
  status: string; erro: string | null; linkReels: string | null; linkTiktok: string | null;
  viewsReels: number | null; viewsTiktok: number | null; postadoEm: string | null; criadoEm: string;
  midia: string | null;
}

export interface Estudo {
  id: number; url: string; titulo: string | null; autor: string | null; status: string;
  erro: string | null; analise: string | null; criadoEm: string;
}

export interface Ideia { id: number; titulo: string; descricao: string | null; status: string; origem: string | null }

export interface Job {
  id: number; tipo: string; titulo: string; status: string;
  progresso: { atual: number; total: number; mensagem: string }; erro: string | null;
}

export interface Estado {
  contagens: {
    fontes: number; radar: number; novos: number; andando: number; aguardandoClaude: number;
    momentos: number; fila: number; prontos: number; postados: number; estudos: number;
  };
  jobs: Job[];
  ajustes: Record<string, string>;
  aoVivo?: { gravando: number; marcasNovas: number };
}

export interface Marca {
  id: number; t: number; tipo: "chat" | "grito" | "manual"; forca: number; detalhe: string;
  em: number; status: "nova" | "clipando" | "clipada" | "ignorada"; momentoId: number | null; erro?: string | null;
}

export interface Live {
  id: number; url: string; canal: string; plataforma: string;
  status: "conectando" | "gravando" | "offline" | "parado" | "erro"; erro: string | null;
  iniciadaEm: number; gravado: number; agora: number; bufferSeg: number; chatMsgs: number; chatAtivo: boolean;
  autoClip: boolean; bufferMb: number;
  marcas: Marca[];
}

async function req<T>(metodo: string, url: string, corpo?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    headers: corpo !== undefined ? { "content-type": "application/json" } : undefined,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { erro?: string }).erro ?? `erro ${r.status}`);
  return d as T;
}

export type EdicaoMomento = Partial<Pick<Momento, "inicio" | "fim" | "gancho" | "legendaReels" | "legendaTiktok" | "hashtags" | "layout" | "edicao" | "status">>
  & { legendas?: { inicio: number; fim: number; texto: string }[] | null; lembrarCam?: boolean };

export const api = {
  estado: () => req<Estado>("GET", "/api/estado"),
  cancelarJob: (id: number) => req("POST", `/api/jobs/${id}/cancelar`),

  fontes: () => req<Fonte[]>("GET", "/api/fontes"),
  criarFonte: (f: Partial<Fonte>) => req<Fonte>("POST", "/api/fontes", f),
  editarFonte: (id: number, f: Partial<Fonte>) => req<Fonte>("PATCH", `/api/fontes/${id}`, f),
  apagarFonte: (id: number) => req("DELETE", `/api/fontes/${id}`),
  buscarFonte: (id: number) => req<Job>("POST", `/api/fontes/${id}/buscar`),

  videos: (tipo: string, status?: string) =>
    req<Video[]>("GET", `/api/videos?tipo=${tipo}${status ? `&status=${status}` : ""}`),
  adicionarVideo: (b: { url: string; tipo: "corte" | "estudo"; fonteId?: number | null; de?: string; ate?: string }) =>
    req<Video>("POST", "/api/videos", b),
  baixar: (id: number) => req<Video>("POST", `/api/videos/${id}/baixar`),
  baixarNovos: () => req<{ enfileirados: number }>("POST", "/api/videos/baixar-novos"),
  transcrever: (id: number) => req<Video>("POST", `/api/videos/${id}/transcrever`),
  descartar: (id: number) => req<Video>("POST", `/api/videos/${id}/descartar`),
  corteManual: (videoId: number) => req<Momento>("POST", `/api/videos/${videoId}/corte-manual`),
  acharCam: (videoId: number) => req<{ cam: Rect | null }>("POST", `/api/videos/${videoId}/achar-cam`),

  lives: () => req<{ lives: Live[]; discoLivreGb: number | null }>("GET", "/api/aovivo"),
  configurarLive: (id: number, b: { autoClip?: boolean }) => req("PATCH", `/api/aovivo/${id}`, b),
  gravarLive: (b: { url: string; fonteId?: number | null; bufferMin?: number; autoClip?: boolean }) => req<{ id: number }>("POST", "/api/aovivo", b),
  pararLive: (id: number, apagar = false) => req("POST", `/api/aovivo/${id}/parar`, { apagar }),
  marcarAgora: (id: number) => req<Marca>("POST", `/api/aovivo/${id}/marcar`),
  ignorarMarca: (id: number, marca: number) => req("POST", `/api/aovivo/${id}/marcas/${marca}/ignorar`),
  cliparLive: (id: number, b: { marcaId?: number; ultimos?: number }) => req<{ momentoId: number }>("POST", `/api/aovivo/${id}/clipar`, b),

  momentos: (status?: string) => req<Momento[]>("GET", `/api/momentos${status ? `?status=${status}` : ""}`),
  editarMomento: (id: number, b: EdicaoMomento) => req<Momento>("PATCH", `/api/momentos/${id}`, b),
  frases: (id: number) => req<Frase[]>("GET", `/api/momentos/${id}/frases`),

  renders: () => req<Render[]>("GET", "/api/renders"),
  renderCurto: (momentoId: number) => req<Render>("POST", "/api/renders", { tipo: "curto", momentoId }),
  renderCompilacao: (b: { momentoIds: number[]; gancho: string; legendaReels?: string; legendaTiktok?: string; hashtags?: string }) =>
    req<Render>("POST", "/api/renders", { tipo: "compilacao", ...b }),
  editarRender: (id: number, b: Partial<Render>) => req<Render>("PATCH", `/api/renders/${id}`, b),
  apagarRender: (id: number) => req("DELETE", `/api/renders/${id}`),

  caderno: () => req<{ regras: string; estudos: Estudo[] }>("GET", "/api/caderno"),
  salvarRegras: (texto: string) => req("PUT", "/api/caderno/regras", { texto }),

  ideias: () => req<Ideia[]>("GET", "/api/ideias"),
  criarIdeia: (b: { titulo: string; descricao?: string }) => req<Ideia[]>("POST", "/api/ideias", b),
  editarIdeia: (id: number, b: Partial<Ideia>) => req<Ideia[]>("PATCH", `/api/ideias/${id}`, b),

  salvarAjustes: (b: Record<string, string>) => req<Record<string, string>>("PUT", "/api/ajustes", b),
};

export const tempo = (s: number | null | undefined) => {
  if (s == null) return "";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

/** 12.3 -> "0:12,3" (o editor precisa do decimo de segundo). */
export const tempoFino = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0").replace(".", ",")}`;
};

export const milhar = (n: number | null | undefined) =>
  n == null ? "" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",")} mil` : String(n);

export async function copiar(txt: string): Promise<void> {
  try { await navigator.clipboard.writeText(txt); } catch { /* sem permissao: ignora */ }
}

export const NOME_LAYOUT: Record<Layout, string> = {
  facecam: "Tela dividida",
  desfocado: "Fundo desfocado",
  cheio: "Tela cheia",
};
