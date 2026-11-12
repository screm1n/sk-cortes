import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALTURA, CAM_PADRAO, LARGURA, TAPAR_PADRAO, calcular, estiloCompleto, fracaoQueCabe, limitarRect, type EstiloLegenda, type Geometria,
} from "../../compartilhado/geometria.ts";
import { agrupar, frasesParaPalavras } from "../../server/fabrica/ass.ts";
import { api, tempoFino, type Edicao, type Frase, type Layout, type Momento, type Rect } from "../lib/api.ts";

/*
 * Editor do corte. Esquerda: o video original com as caixas de recorte (camera em
 * amarelo, jogo em turquesa). Meio: a previa 9:16 desenhada num canvas com a MESMA
 * geometria que o ffmpeg usa, entao o que aparece aqui e o que sai no mp4.
 */

const ESCALA = 0.5; // canvas 540x960

const CORES = [
  { cor: "#FFE14D", nome: "Amarelo" },
  { cor: "#3BFF6B", nome: "Verde" },
  { cor: "#FF4FA3", nome: "Rosa" },
  { cor: "#33E1CF", nome: "Turquesa" },
  { cor: "#FF5D3B", nome: "Laranja" },
  { cor: "#FFFFFF", nome: "Branco (sem destaque)" },
];
const DUR_MIN = 3;

const limitar = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const decimo = (n: number) => Math.round(n * 10) / 10;

/** Encaixa o retangulo numa proporcao (largura/altura em fracao do quadro), mantendo o centro. */
function encaixar(r: Rect, prop: number): Rect {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  let w = r.w, h = w / prop;
  if (h > 1) { h = 1; w = h * prop; }
  if (w > 1) { w = 1; h = w / prop; }
  return { x: limitar(cx - w / 2, 0, 1 - w), y: limitar(cy - h / 2, 0, 1 - h), w, h };
}

type Canto = "nw" | "ne" | "sw" | "se";

function Caixa({ rect, classe, rotulo, palco, aoMudar, aoSoltar, prop }: {
  rect: Rect; classe: string; rotulo: string; palco: React.RefObject<HTMLDivElement | null>;
  aoMudar: (r: Rect) => void; aoSoltar?: (r: Rect) => void;
  /** Trava a proporcao (largura/altura em fracao do quadro). */
  prop?: number;
}) {
  const arrasto = useRef<{ px: number; py: number; r: Rect; modo: "mover" | Canto } | null>(null);
  const ultimo = useRef(rect);

  const baixar = (modo: "mover" | Canto) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    arrasto.current = { px: e.clientX, py: e.clientY, r: rect, modo };
  };

  const mover = (e: React.PointerEvent) => {
    const a = arrasto.current;
    const el = palco.current;
    if (!a || !el) return;
    const b = el.getBoundingClientRect();
    const dx = (e.clientX - a.px) / b.width;
    const dy = (e.clientY - a.py) / b.height;
    let { x, y, w, h } = a.r;
    if (a.modo === "mover") {
      x = limitar(x + dx, 0, 1 - w);
      y = limitar(y + dy, 0, 1 - h);
    } else {
      let x0 = x, y0 = y, x1 = x + w, y1 = y + h;
      if (a.modo.includes("w")) x0 = limitar(x0 + dx, 0, x1 - 0.06);
      if (a.modo.includes("e")) x1 = limitar(x1 + dx, x0 + 0.06, 1);
      if (a.modo.includes("n")) y0 = limitar(y0 + dy, 0, y1 - 0.06);
      if (a.modo.includes("s")) y1 = limitar(y1 + dy, y0 + 0.06, 1);
      w = x1 - x0; h = y1 - y0; x = x0; y = y0;
      if (prop) {
        // Proporcao travada: a largura manda; a altura acompanha, presa no canto oposto.
        const cima = a.modo.includes("n");
        const espaco = cima ? y1 : 1 - y0;
        h = w / prop;
        if (h > espaco) { h = espaco; w = h * prop; if (a.modo.includes("w")) x = x1 - w; }
        y = cima ? y1 - h : y0;
      }
    }
    ultimo.current = { x, y, w, h };
    aoMudar(ultimo.current);
  };

  const soltar = () => {
    if (arrasto.current) aoSoltar?.(ultimo.current);
    arrasto.current = null;
  };

  return (
    <div className={`caixa ${classe}`} onPointerDown={baixar("mover")} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}
      style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}>
      <span className="caixa-rotulo">{rotulo}</span>
      {(["nw", "ne", "sw", "se"] as Canto[]).map((c) => (
        <i key={c} className={`alca alca-${c}`} onPointerDown={baixar(c)} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ desenho da previa */

function quebrarLinhas(ctx: CanvasRenderingContext2D, texto: string, max: number): string[] {
  const linhas: string[] = [];
  let atual = "";
  for (const p of texto.split(/\s+/).filter(Boolean)) {
    const tenta = atual ? `${atual} ${p}` : p;
    if (atual && ctx.measureText(tenta).width > max) { linhas.push(atual); atual = p; } else atual = tenta;
  }
  if (atual) linhas.push(atual);
  return linhas;
}

interface Bloco { i: number; f: number; palavras: { i: number; w: string }[] }

let quadroTapado: HTMLCanvasElement | null = null;

function desenhar(
  ctx: CanvasRenderingContext2D, video: HTMLVideoElement, g: Geometria,
  o: { gancho: string; t: number; inicio: number; blocos: Bloco[]; semLegenda: boolean; credito: string | null; marca: string | null; estilo: Required<EstiloLegenda> }
) {
  const e = ESCALA;
  const W = LARGURA * e, H = ALTURA * e;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (video.readyState < 2 || !video.videoWidth) return;

  // Com regiao "tapar", desenha a partir de uma copia do quadro com aquele pedaco borrado.
  let fonte: CanvasImageSource = video;
  if (g.tapar) {
    const c = quadroTapado ?? (quadroTapado = document.createElement("canvas"));
    if (c.width !== video.videoWidth) { c.width = video.videoWidth; c.height = video.videoHeight; }
    const q = c.getContext("2d")!;
    q.drawImage(video, 0, 0);
    const t = g.tapar;
    q.save();
    q.beginPath(); q.rect(t.x, t.y, t.w, t.h); q.clip();
    q.filter = "blur(18px)";
    q.drawImage(video, 0, 0);
    q.restore();
    fonte = c;
  }

  if (g.fundo) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const alvo = W / H;
    const sw = vw / vh > alvo ? vh * alvo : vw;
    const sh = vw / vh > alvo ? vh : vw / alvo;
    ctx.filter = "blur(14px) brightness(0.75) saturate(1.3)";
    ctx.drawImage(fonte, (vw - sw) / 2, (vh - sh) / 2, sw, sh, -20, -20, W + 40, H + 40);
    ctx.filter = "none";
  }
  for (const p of g.paineis) {
    ctx.drawImage(fonte, p.origem.x, p.origem.y, p.origem.w, p.origem.h,
      p.destino.x * e, p.destino.y * e, p.destino.w * e, p.destino.h * e);
  }

  ctx.textBaseline = "top";
  ctx.lineJoin = "round";

  // Gancho: tarja rosa no topo.
  const dentro = o.t - o.inicio;
  if (o.gancho.trim() && (g.ganchoAte === null || dentro < g.ganchoAte)) {
    const tam = 62 * e, pad = 16 * e, alturaLinha = tam * 1.22;
    ctx.font = `900 ${tam}px "Arial Black", Arial, sans-serif`;
    ctx.textAlign = "center";
    const linhas = quebrarLinhas(ctx, o.gancho.toUpperCase(), (LARGURA - 190) * e);
    linhas.forEach((l, k) => {
      const largura = ctx.measureText(l).width;
      const y = g.ganchoY * e + k * alturaLinha;
      ctx.fillStyle = "#ff4fa3";
      ctx.fillRect(W / 2 - largura / 2 - pad, y - pad * 0.6, largura + pad * 2, tam + pad * 1.4);
      ctx.fillStyle = "#fff";
      ctx.fillText(l, W / 2, y);
    });
  }

  // Legenda: bloco de ate 3 palavras, a falada agora em amarelo.
  if (!o.semLegenda) {
    const k = o.blocos.findIndex((b, n) => o.t >= b.i && o.t < Math.min(b.f + 0.35, o.blocos[n + 1]?.i ?? Infinity));
    const bloco = o.blocos[k];
    if (bloco) {
      const est = o.estilo;
      const tam = 86 * est.tamanho * e;
      ctx.font = `${est.fonte === "Bahnschrift" ? 700 : 900} ${tam}px "${est.fonte}", Arial, sans-serif`;
      ctx.textAlign = "left";
      const espaco = ctx.measureText(" ").width;
      const larguras = bloco.palavras.map((p) => ctx.measureText(p.w).width);
      const total = larguras.reduce((a, b) => a + b, 0) + espaco * (bloco.palavras.length - 1);
      let x = W / 2 - total / 2;
      const y = (g.legendaY + est.deslocar) * e - tam / 2;
      let atual = 0;
      bloco.palavras.forEach((p, n) => { if (o.t >= p.i) atual = n; });
      bloco.palavras.forEach((p, n) => {
        ctx.lineWidth = 14 * est.tamanho * e;
        ctx.strokeStyle = "#000";
        ctx.strokeText(p.w, x, y);
        ctx.fillStyle = n === atual ? est.cor : "#fff";
        ctx.fillText(p.w, x, y);
        x += larguras[n]! + espaco;
      });
    }
  }

  // Credito e @ do perfil, pequenos no rodape.
  ctx.font = `700 ${34 * e}px Arial, sans-serif`;
  ctx.textAlign = "center";
  const topo = g.creditoTopo;
  ctx.textBaseline = topo !== undefined ? "top" : "bottom";
  ctx.globalAlpha = 0.5;
  const linhasCredito = [o.credito, o.marca].filter(Boolean) as string[];
  linhasCredito.map((txt, k) => [txt, topo !== undefined ? topo + k * 42 : ALTURA - 150 + k * 50] as const).forEach(([txt, y]) => {
    ctx.lineWidth = 6 * e;
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.strokeText(txt as string, W / 2, (y as number) * e);
    ctx.fillStyle = "#fff";
    ctx.fillText(txt as string, W / 2, (y as number) * e);
  });
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------- o editor */

const MODELOS: { id: Layout; nome: string; desc: string }[] = [
  { id: "facecam", nome: "Tela dividida", desc: "Jogo e câmera do streamer, um em cima do outro" },
  { id: "desfocado", nome: "Fundo desfocado", desc: "Vídeo inteiro no centro, borrado atrás" },
  { id: "cheio", nome: "Tela cheia", desc: "Só um pedaço do jogo, ocupando tudo" },
];

export function Editor({ momento: m, marca, aoFechar, aoSalvar }: {
  momento: Momento; marca: string | null; aoFechar: () => void; aoSalvar: (aviso: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const palco = useRef<HTMLDivElement>(null);
  const trilha = useRef<HTMLDivElement>(null);

  const [inicio, setInicio] = useState(m.inicio);
  const [fim, setFim] = useState(m.fim);
  const [gancho, setGancho] = useState(m.gancho);
  const [layout, setLayout] = useState<Layout>(m.layout);
  const [edicao, setEdicao] = useState<Edicao>(() => ({ ...(m.edicao ?? {}), cam: m.edicao?.cam ?? m.camLembrada ?? null }));
  const [fracaoManual, setFracaoManual] = useState(m.edicao?.camFracao !== undefined);
  const [lembrar, setLembrar] = useState(true);
  const [estiloPadrao, setEstiloPadrao] = useState<EstiloLegenda | null>(null);
  const [estiloSalvo, setEstiloSalvo] = useState(false);
  useEffect(() => {
    api.estado().then((s) => { try { setEstiloPadrao(JSON.parse(s.ajustes.estiloLegenda ?? "null")); } catch { /* sem padrao */ } }).catch(() => {});
  }, []);
  const estilo = estiloCompleto(edicao.estilo ?? estiloPadrao);
  const mudarEstilo = (parte: EstiloLegenda) => setEdicao((ed) => ({ ...ed, estilo: { ...estiloCompleto(ed.estilo ?? estiloPadrao), ...parte } }));
  const [frases, setFrases] = useState<Frase[]>([]);
  const [frasesSujas, setFrasesSujas] = useState(false);
  const [post, setPost] = useState({ reels: m.legendaReels ?? "", tiktok: m.legendaTiktok ?? "", tags: m.hashtags ?? "" });
  const [dims, setDims] = useState({ w: m.video.largura ?? 1280, h: m.video.altura ?? 720 });
  const [duracao, setDuracao] = useState(m.video.duracao ?? m.fim + 5);
  const [t, setT] = useState(m.inicio);
  const [tocando, setTocando] = useState(false);
  const [procurando, setProcurando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { api.frases(m.id).then(setFrases).catch(() => {}); }, [m.id]);

  const g = useMemo(
    () => calcular(layout === "facecam" && !edicao.cam ? "desfocado" : layout, dims.w, dims.h, edicao),
    [layout, dims, edicao]
  );

  const blocos = useMemo<Bloco[]>(() =>
    agrupar(frasesParaPalavras(frases, 0, 1e9), estilo.maiusculas).map((b) => ({
      i: b[0]!.i, f: b[b.length - 1]!.f, palavras: b.map((p) => ({ i: p.i, w: p.w })),
    })), [frases, estilo.maiusculas]);

  // Tudo que o desenho precisa fica num ref: o laco de animacao nao recomeca a cada tecla.
  const cena = useRef({ g, gancho, inicio, fim, blocos, semLegenda: !!edicao.semLegenda, estilo });
  cena.current = { g, gancho, inicio, fim, blocos, semLegenda: !!edicao.semLegenda, estilo };

  const credito = m.video.autor
    ? `via @${m.video.autor.replace(/^@/, "")}${m.video.plataforma && m.video.plataforma !== "outro" ? ` · ${m.video.plataforma}` : ""}`
    : null;

  useEffect(() => {
    let vivo = true;
    let quadro = 0;
    const laco = () => {
      if (!vivo) return;
      const v = video.current, c = canvas.current;
      if (v && c) {
        const s = cena.current;
        // Toca em laco dentro do corte.
        if (!v.paused && v.currentTime >= s.fim) v.currentTime = s.inicio;
        const ctx = c.getContext("2d");
        if (ctx) desenhar(ctx, v, s.g, { gancho: s.gancho, t: v.currentTime, inicio: s.inicio, blocos: s.blocos, semLegenda: s.semLegenda, credito, marca, estilo: s.estilo });
        // O relogio da tela nao precisa de 60 atualizacoes por segundo.
        if (quadro++ % 6 === 0) setT(v.currentTime);
      }
      requestAnimationFrame(laco);
    };
    requestAnimationFrame(laco);
    return () => { vivo = false; };
  }, [credito, marca]);

  const ir = useCallback((seg: number) => {
    const v = video.current;
    if (v) v.currentTime = limitar(seg, 0, duracao);
  }, [duracao]);

  const alternar = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < cena.current.inicio || v.currentTime >= cena.current.fim) v.currentTime = cena.current.inicio;
      void v.play();
    } else v.pause();
  }, []);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      const digitando = ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName);
      if (e.key === "Escape") aoFechar();
      else if (e.key === " " && !digitando) { e.preventDefault(); alternar(); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aoFechar, alternar]);

  /* --------------------------------------------------------------- recortes */

  const propPainel = (nome: "jogo" | "cam") => {
    const p = g.paineis.find((x) => x.nome === nome);
    return p ? (p.destino.w / p.destino.h) * (dims.h / dims.w) : 1;
  };

  // Sem recorte do jogo escolhido, a caixa mostra o que o "automatico" esta pegando.
  const jogoVisivel: Rect | null = useMemo(() => {
    if (edicao.jogo) return edicao.jogo;
    const p = g.paineis.find((x) => x.nome === "jogo");
    return p ? { x: p.origem.x / dims.w, y: p.origem.y / dims.h, w: p.origem.w / dims.w, h: p.origem.h / dims.h } : null;
  }, [edicao.jogo, g, dims]);

  const mudarCam = (cam: Rect) => setEdicao((e) => {
    const nova: Edicao = { ...e, cam: limitarRect(cam) };
    // Faixa da camera acompanha a caixa, pra mostrar ela inteira (ate ele mexer no tamanho na mao).
    if (!fracaoManual) nova.camFracao = fracaoQueCabe(nova.cam!, dims.w, dims.h);
    return nova;
  });

  // Mudou o tamanho/posicao da camera: o painel do jogo muda de formato, o recorte dele acompanha.
  const reencaixarJogo = (e: Edicao, lay: Layout): Edicao => {
    if (!e.jogo) return e;
    const gg = calcular(lay, dims.w, dims.h, e);
    const p = gg.paineis.find((x) => x.nome === "jogo");
    if (!p) return e;
    return { ...e, jogo: encaixar(e.jogo, (p.destino.w / p.destino.h) * (dims.h / dims.w)) };
  };

  const acharCam = async () => {
    setProcurando(true); setErro(""); setAviso("");
    try {
      const r = await api.acharCam(m.videoId);
      if (r.cam) { mudarCam(r.cam); setAviso("Achei a câmera. Confira a caixa amarela e ajuste se precisar."); }
      else { setEdicao((e) => ({ ...e, cam: e.cam ?? CAM_PADRAO })); setAviso("Não achei a câmera sozinho. Arraste a caixa amarela pra cima dela."); }
    } catch (e) { setErro((e as Error).message); }
    setProcurando(false);
  };

  const escolherModelo = (id: Layout) => {
    setLayout(id);
    setEdicao((e) => ({ ...e, jogo: null }));
    if (id === "facecam" && !edicao.cam) void acharCam();
  };

  // Abriu um corte que ja esta em tela dividida mas sem camera marcada: procura sozinho.
  useEffect(() => {
    if (m.layout === "facecam" && !m.edicao?.cam && !m.camLembrada) void acharCam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id]);

  /* --------------------------------------------------------------- linha do tempo */

  const janela = useMemo(() => {
    if (duracao <= 180) return { de: 0, ate: duracao };
    const de = Math.max(0, m.inicio - 60);
    return { de, ate: Math.min(duracao, Math.max(m.fim + 60, de + 180)) };
  }, [duracao, m.inicio, m.fim]);
  const pct = (seg: number) => `${limitar(((seg - janela.de) / (janela.ate - janela.de)) * 100, 0, 100)}%`;

  const arrastoTrilha = useRef<"inicio" | "fim" | "agulha" | null>(null);
  const segDoPonteiro = (e: React.PointerEvent) => {
    const b = trilha.current!.getBoundingClientRect();
    return decimo(janela.de + limitar((e.clientX - b.left) / b.width, 0, 1) * (janela.ate - janela.de));
  };
  const trilhaBaixar = (e: React.PointerEvent) => {
    const seg = segDoPonteiro(e);
    const b = trilha.current!.getBoundingClientRect();
    const px = (s: number) => ((s - janela.de) / (janela.ate - janela.de)) * b.width;
    const x = e.clientX - b.left;
    const dIni = Math.abs(x - px(inicio)), dFim = Math.abs(x - px(fim));
    arrastoTrilha.current = Math.min(dIni, dFim) <= 12 ? (dIni <= dFim ? "inicio" : "fim") : "agulha";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (arrastoTrilha.current === "agulha") ir(seg);
  };
  const trilhaMover = (e: React.PointerEvent) => {
    const modo = arrastoTrilha.current;
    if (!modo) return;
    const seg = segDoPonteiro(e);
    if (modo === "inicio") { const v = limitar(seg, 0, fim - DUR_MIN); setInicio(v); ir(v); }
    else if (modo === "fim") { const v = limitar(seg, inicio + DUR_MIN, duracao); setFim(v); ir(v - 0.05); }
    else ir(seg);
  };

  const dur = fim - inicio;
  const dicaDur = dur < 15 ? "curto: rende mais dentro de uma compilação" : dur <= 40 ? "tamanho ideal pra corte" : dur >= 61 ? "passa de 1 min: paga no TikTok" : "entre 40 e 60 s: ou encurta, ou estica pra 61";

  /* --------------------------------------------------------------------- salvar */

  const salvar = async (renderizar: boolean) => {
    setErro(""); setSalvando(true);
    try {
      const { cam, ...resto } = edicao;
      await api.editarMomento(m.id, {
        inicio: decimo(inicio), fim: decimo(fim), gancho: gancho.trim(), layout,
        edicao: { ...resto, ...(cam ? { cam } : {}) },
        ...(frasesSujas ? { legendas: frases.filter((f) => f.texto.trim()).map(({ inicio, fim, texto }) => ({ inicio, fim, texto: texto.trim() })) } : {}),
        legendaReels: post.reels || null, legendaTiktok: post.tiktok || null, hashtags: post.tags || null,
        lembrarCam: layout === "facecam" && lembrar && !!cam,
        ...(renderizar ? { status: "aprovado" } : {}),
      });
      if (renderizar) await api.renderCurto(m.id);
      aoSalvar(renderizar ? "Foi pra fábrica. O vídeo aparece na Fila em alguns segundos." : "Edição salva.");
    } catch (e) { setErro((e as Error).message); setSalvando(false); }
  };

  const falasVisiveis = frases.map((f, k) => ({ f, k })).filter(({ f }) => f.fim > inicio - 6 && f.inicio < fim + 6);
  const mostraCaixas = layout !== "desfocado";

  return (
    <div className="editor" role="dialog" aria-label="Editor do corte">
      <header className="editor-topo">
        <button className="btn btn-fantasma" onClick={aoFechar}>← Voltar</button>
        <input className="editor-gancho" value={gancho} maxLength={90} autoFocus={m.porque === "corte manual"}
          onFocus={(e) => { if (e.target.value === "Escreva o gancho aqui") e.target.select(); }} onChange={(e) => setGancho(e.target.value)} aria-label="Gancho (texto da tarja rosa)" placeholder="Gancho: a frase da tarja rosa" />
        <button className="btn" disabled={salvando} onClick={() => salvar(false)}>Salvar</button>
        <button className="btn btn-forte" disabled={salvando || dur < DUR_MIN || gancho.trim().length < 3} onClick={() => salvar(true)}>Salvar e renderizar</button>
      </header>
      {erro && <div className="alerta alerta-erro editor-alerta">{erro}</div>}
      {aviso && <div className="alerta editor-alerta">{aviso}</div>}

      <div className="editor-corpo">
        {/* ------------------------------------------------ video original */}
        <section className="editor-origem">
          <div className="rotulo-secao">Vídeo original {mostraCaixas && <span>arraste as caixas pra escolher o que aparece</span>}</div>
          <div className="palco" ref={palco}>
            <video ref={video} src={m.midia ?? undefined} playsInline preload="auto"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth) setDims({ w: v.videoWidth, h: v.videoHeight });
                if (Number.isFinite(v.duration)) setDuracao(v.duration);
                v.currentTime = m.inicio;
              }}
              onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onSeeked={(e) => setT(e.currentTarget.currentTime)}
              onPlay={() => setTocando(true)} onPause={() => setTocando(false)} onClick={alternar} />
            {mostraCaixas && jogoVisivel && (
              <Caixa rect={jogoVisivel} classe="caixa-jogo" rotulo="JOGO" palco={palco} prop={propPainel("jogo")}
                aoMudar={(r) => setEdicao((e) => ({ ...e, jogo: r }))} />
            )}
            {edicao.tapar && (
              <Caixa rect={edicao.tapar} classe="caixa-tapar" rotulo="BORRAR" palco={palco}
                aoMudar={(r) => setEdicao((e) => ({ ...e, tapar: limitarRect(r) }))} />
            )}
            {layout === "facecam" && edicao.cam && (
              <Caixa rect={edicao.cam} classe="caixa-cam" rotulo="CÂMERA" palco={palco} aoMudar={mudarCam}
                aoSoltar={() => setEdicao((e) => reencaixarJogo(e, layout))} />
            )}
          </div>

          <div className="transporte">
            <button className="btn btn-redondo" onClick={alternar} aria-label={tocando ? "Pausar" : "Tocar"}>{tocando ? "❚❚" : "▶"}</button>
            <code className="relogio">{tempoFino(t)}</code>
            <button className="btn" onClick={() => { const v = limitar(decimo(t), 0, fim - DUR_MIN); setInicio(v); }}>Começar aqui</button>
            <button className="btn" onClick={() => { const v = limitar(decimo(t), inicio + DUR_MIN, duracao); setFim(v); }}>Terminar aqui</button>
            <span className={`duracao ${dur >= 61 ? "ok" : ""}`}><b>{dur.toFixed(1).replace(".", ",")} s</b> {dicaDur}</span>
          </div>

          <div className="trilha" ref={trilha} onPointerDown={trilhaBaixar} onPointerMove={trilhaMover}
            onPointerUp={() => { arrastoTrilha.current = null; }} onPointerCancel={() => { arrastoTrilha.current = null; }}>
            {frases.map((f, k) => (
              <i key={k} className="trilha-fala" style={{ left: pct(f.inicio), width: `calc(${pct(f.fim)} - ${pct(f.inicio)})` }} />
            ))}
            <div className="trilha-corte" style={{ left: pct(inicio), width: `calc(${pct(fim)} - ${pct(inicio)})` }} />
            <div className="trilha-alca" style={{ left: pct(inicio) }}><span>{tempoFino(inicio)}</span></div>
            <div className="trilha-alca trilha-alca-fim" style={{ left: pct(fim) }}><span>{tempoFino(fim)}</span></div>
            <div className="trilha-agulha" style={{ left: pct(t) }} />
          </div>
          <div className="ajuste-fino">
            <span>início</span>
            <button className="mini" onClick={() => setInicio(limitar(decimo(inicio - 0.5), 0, fim - DUR_MIN))}>−0,5</button>
            <button className="mini" onClick={() => setInicio(limitar(decimo(inicio + 0.5), 0, fim - DUR_MIN))}>+0,5</button>
            <span>fim</span>
            <button className="mini" onClick={() => setFim(limitar(decimo(fim - 0.5), inicio + DUR_MIN, duracao))}>−0,5</button>
            <button className="mini" onClick={() => setFim(limitar(decimo(fim + 0.5), inicio + DUR_MIN, duracao))}>+0,5</button>
            <button className="mini" onClick={() => { ir(inicio); void video.current?.play(); }}>ver do início</button>
            <button className="mini" onClick={() => { ir(Math.max(inicio, fim - 3)); void video.current?.play(); }}>ver o final</button>
          </div>

          <div className="rotulo-secao">Falas {frasesSujas && <span>editadas: a legenda vai usar o seu texto</span>}</div>
          <div className="falas">
            {falasVisiveis.length === 0 && <div className="sutil">Nenhuma fala nesse trecho.</div>}
            {falasVisiveis.map(({ f, k }) => {
              const dentro = f.fim > inicio && f.inicio < fim;
              return (
                <div key={k} className={`fala ${dentro ? "" : "fala-fora"} ${t >= f.inicio && t < f.fim ? "fala-agora" : ""}`}>
                  <button className="mini" onClick={() => ir(f.inicio)} title="Ir pra essa fala">{tempoFino(f.inicio)}</button>
                  <input value={f.texto} aria-label="Texto da fala" onChange={(e) => {
                    setFrases((fs) => fs.map((x, n) => (n === k ? { ...x, texto: e.target.value } : x)));
                    setFrasesSujas(true);
                  }} />
                </div>
              );
            })}
          </div>
        </section>

        {/* ------------------------------------------------------- previa */}
        <section className="editor-previa">
          <div className="rotulo-secao">Como vai sair</div>
          <canvas ref={canvas} width={LARGURA * ESCALA} height={ALTURA * ESCALA} onClick={alternar} />
        </section>

        {/* ------------------------------------------------------ opcoes */}
        <aside className="editor-painel">
          <div className="rotulo-secao">Modelo</div>
          <div className="modelos">
            {MODELOS.map((x) => (
              <button key={x.id} className="modelo" aria-pressed={layout === x.id} onClick={() => escolherModelo(x.id)}>
                <span className={`mini-tela mini-${x.id} ${x.id === "facecam" && (edicao.camPos ?? "baixo") === "cima" ? "mini-cam-cima" : ""}`} aria-hidden><i /><b /></span>
                <span><strong>{x.nome}</strong><small>{x.desc}</small></span>
              </button>
            ))}
          </div>

          {layout === "facecam" && (
            <div className="grupo">
              <div className="rotulo-secao">Câmera do streamer</div>
              <div className="segmento">
                {(["cima", "baixo"] as const).map((pos) => (
                  <button key={pos} aria-pressed={(edicao.camPos ?? "baixo") === pos}
                    onClick={() => setEdicao((e) => reencaixarJogo({ ...e, camPos: pos }, layout))}>{pos === "cima" ? "Em cima" : "Embaixo"}</button>
                ))}
              </div>
              <label>Tamanho da câmera <span className="valor">{Math.round((edicao.camFracao ?? 0.36) * 100)}% da tela</span>
                <input type="range" min={20} max={55} value={Math.round((edicao.camFracao ?? 0.36) * 100)}
                  onChange={(e) => { setFracaoManual(true); setEdicao((ed) => reencaixarJogo({ ...ed, camFracao: Number(e.target.value) / 100 }, layout)); }} />
              </label>
              <div className="acoes">
                <button className="btn" disabled={procurando} onClick={acharCam}>{procurando ? "Procurando…" : "Detectar câmera"}</button>
                {fracaoManual && edicao.cam && (
                  <button className="btn btn-fantasma" onClick={() => { setFracaoManual(false); setEdicao((e) => reencaixarJogo({ ...e, camFracao: fracaoQueCabe(e.cam!, dims.w, dims.h) }, layout)); }}>Mostrar câmera inteira</button>
                )}
              </div>
              {m.video.autor && (
                <label className="check"><input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} /> Usar essa câmera nos próximos cortes de @{m.video.autor}</label>
              )}
            </div>
          )}

          {layout === "desfocado" && (
            <div className="grupo">
              <label>Zoom do jogo <span className="valor">{Math.round((edicao.zoom ?? 1.25) * 100)}%</span>
                <input type="range" min={100} max={220} step={5} value={Math.round((edicao.zoom ?? 1.25) * 100)}
                  onChange={(e) => setEdicao((ed) => ({ ...ed, zoom: Number(e.target.value) / 100 }))} />
              </label>
            </div>
          )}

          {mostraCaixas && edicao.jogo && (
            <button className="btn btn-fantasma" onClick={() => setEdicao((e) => ({ ...e, jogo: null }))}>Centralizar o jogo de novo</button>
          )}

          <div className="grupo">
            <div className="rotulo-secao">Texto na tela</div>
            <label>Gancho (a tarja rosa no topo) <span className="valor">{gancho.length}/90</span>
              <textarea className="campo-gancho" rows={2} maxLength={90} value={gancho} placeholder="Ex.: Ele não esperava isso"
                onChange={(e) => setGancho(e.target.value.replace(/\n/g, " "))}
                onFocus={(e) => { if (e.target.value === "Escreva o gancho aqui") e.target.select(); }} />
            </label>
            <label>Gancho fica
              <select value={edicao.ganchoSegundos === undefined ? "padrao" : String(edicao.ganchoSegundos)}
                onChange={(e) => setEdicao((ed) => {
                  const { ganchoSegundos: _fora, ...resto } = ed;
                  return e.target.value === "padrao" ? resto : { ...resto, ganchoSegundos: Number(e.target.value) };
                })}>
                <option value="padrao">{layout === "facecam" ? "só nos 4 primeiros segundos" : "o vídeo todo"} (padrão)</option>
                <option value="0">o vídeo todo</option>
                <option value="3">3 segundos</option>
                <option value="5">5 segundos</option>
                <option value="8">8 segundos</option>
              </select>
            </label>
            <label className="check"><input type="checkbox" checked={!edicao.semLegenda} onChange={(e) => setEdicao((ed) => ({ ...ed, semLegenda: !e.target.checked }))} /> Nossa legenda palavra a palavra</label>
            <label className="check"><input type="checkbox" checked={!!edicao.tapar}
              onChange={(e) => setEdicao((ed) => ({ ...ed, tapar: e.target.checked ? TAPAR_PADRAO : null }))} /> Borrar a legenda que já vem no vídeo</label>
            {edicao.tapar && <p className="sutil">Arraste a caixa vermelha no vídeo original pra cima da legenda dele.</p>}
          </div>

          {!edicao.semLegenda && (
            <div className="grupo">
              <div className="rotulo-secao">Estilo da legenda</div>
              <div className="cores" role="group" aria-label="Cor da palavra falada">
                {CORES.map((c) => (
                  <button key={c.cor} className="cor" aria-pressed={estilo.cor.toUpperCase() === c.cor} title={c.nome}
                    style={{ background: c.cor }} onClick={() => mudarEstilo({ cor: c.cor })} />
                ))}
              </div>
              <label>Fonte
                <select value={estilo.fonte} onChange={(e) => mudarEstilo({ fonte: e.target.value as EstiloLegenda["fonte"] })}>
                  <option value="Arial Black">Grossa (Arial Black)</option>
                  <option value="Impact">Estreita (Impact)</option>
                  <option value="Bahnschrift">Moderna (Bahnschrift)</option>
                </select>
              </label>
              <label>Tamanho <span className="valor">{Math.round(estilo.tamanho * 100)}%</span>
                <input type="range" min={70} max={150} step={5} value={Math.round(estilo.tamanho * 100)} onChange={(e) => mudarEstilo({ tamanho: Number(e.target.value) / 100 })} />
              </label>
              <label>Altura <span className="valor">{estilo.deslocar === 0 ? "padrão" : estilo.deslocar < 0 ? "mais alto" : "mais baixo"}</span>
                <input type="range" min={-400} max={400} step={10} value={estilo.deslocar} onChange={(e) => mudarEstilo({ deslocar: Number(e.target.value) })} />
              </label>
              <label className="check"><input type="checkbox" checked={estilo.maiusculas} onChange={(e) => mudarEstilo({ maiusculas: e.target.checked })} /> Tudo em maiúsculas</label>
              <div className="acoes">
                <button className="btn" onClick={async () => {
                  await api.salvarAjustes({ estiloLegenda: JSON.stringify(estilo) });
                  setEstiloPadrao(estilo); setEstiloSalvo(true); setTimeout(() => setEstiloSalvo(false), 1600);
                }}>{estiloSalvo ? "Virou o padrão" : "Usar em todos os cortes"}</button>
                <button className="btn btn-fantasma" onClick={() => setEdicao((ed) => { const { estilo: _fora, ...resto } = ed; return resto; })}>Voltar ao padrão</button>
              </div>
            </div>
          )}

          <details className="grupo">
            <summary className="rotulo-secao">Texto do post (legenda do Reels e TikTok) ▾</summary>
            <label>Legenda do Reels<textarea rows={3} value={post.reels} onChange={(e) => setPost({ ...post, reels: e.target.value })} /></label>
            <label>Legenda do TikTok<textarea rows={2} value={post.tiktok} onChange={(e) => setPost({ ...post, tiktok: e.target.value })} /></label>
            <label>Hashtags<input value={post.tags} onChange={(e) => setPost({ ...post, tags: e.target.value })} /></label>
          </details>

          <p className="sutil atalhos">Espaço toca e pausa · Esc fecha</p>
        </aside>
      </div>
    </div>
  );
}
