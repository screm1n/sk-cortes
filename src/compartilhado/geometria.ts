/*
 * Geometria do video 9:16, compartilhada entre o servidor (que monta o filtro do
 * ffmpeg) e o painel (que desenha a previa no canvas). Como os dois usam os mesmos
 * numeros, o que aparece na previa do editor e exatamente o que o ffmpeg renderiza.
 */

export const LARGURA = 1080;
export const ALTURA = 1920;

/** Retangulo em fracao (0..1) do quadro original. */
export interface Rect { x: number; y: number; w: number; h: number }

/** Retangulo em pixels. */
export interface Px { x: number; y: number; w: number; h: number }

/** "facecam" e a tela dividida (camera + jogo). O nome ficou do primeiro desenho. */
export type Layout = "desfocado" | "facecam" | "cheio";

/** Estilo da legenda palavra a palavra. Tudo opcional: o que faltar usa o padrao. */
export interface EstiloLegenda {
  /** Multiplica o tamanho padrao (86 px na tela 1080x1920). 0.7 a 1.5. */
  tamanho?: number;
  /** Cor da palavra falada agora, em #RRGGBB. */
  cor?: string;
  fonte?: "Arial Black" | "Impact" | "Bahnschrift";
  /** Sobe (negativo) ou desce (positivo) a legenda, em px da tela final. */
  deslocar?: number;
  maiusculas?: boolean;
}

export const ESTILO_PADRAO: Required<EstiloLegenda> = {
  tamanho: 1, cor: "#FFE14D", fonte: "Arial Black", deslocar: 0, maiusculas: true,
};

export function estiloCompleto(e?: EstiloLegenda | null): Required<EstiloLegenda> {
  return { ...ESTILO_PADRAO, ...(e ?? {}) };
}

export interface Edicao {
  /** Onde esta a camera do streamer no video original. */
  cam?: Rect | null;
  /** Que parte do jogo aparece. null = o quadro todo (centralizado). */
  jogo?: Rect | null;
  camPos?: "cima" | "baixo";
  /** Altura da faixa da camera, em fracao da tela (0.2 a 0.55). */
  camFracao?: number;
  /** Zoom do jogo no modelo desfocado (1 = largura inteira, mais = corta as bordas). */
  zoom?: number;
  /** Segundos que o gancho fica na tela. 0 = o video todo. Sem valor = padrao do modelo. */
  ganchoSegundos?: number;
  semLegenda?: boolean;
  estilo?: EstiloLegenda;
  /** Pedaco do video original que sai borrado (ex.: legenda que ja vem queimada na live). */
  tapar?: Rect | null;
}

export interface Painel {
  nome: "jogo" | "cam";
  /** Recorte no video original, em px. */
  origem: Px;
  /** Onde entra na tela 1080x1920, em px. */
  destino: Px;
}

export interface Geometria {
  layout: Layout;
  /** Fundo = o proprio video borrado, ocupando a tela toda. */
  fundo: boolean;
  paineis: Painel[];
  legendaY: number;
  ganchoY: number;
  /** null = gancho fica o video todo. */
  ganchoAte: number | null;
  /** Topo do credito (via @streamer + @perfil). Sem valor = rodape da tela. */
  creditoTopo?: number;
  /** Regiao do video original (px) borrada antes de montar a tela. */
  tapar: Px | null;
}

export const TAPAR_PADRAO: Rect = { x: 0.15, y: 0.84, w: 0.7, h: 0.14 };

export const CAM_PADRAO: Rect = { x: 0.72, y: 0.66, w: 0.28, h: 0.34 };
export const CAM_FRACAO_PADRAO = 0.36;

const par = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const limitar = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function limitarRect(r: Rect): Rect {
  const w = limitar(r.w, 0.05, 1);
  const h = limitar(r.h, 0.05, 1);
  return { x: limitar(r.x, 0, 1 - w), y: limitar(r.y, 0, 1 - h), w, h };
}

/**
 * Dentro da regiao escolhida, pega o maior recorte centralizado com a proporcao do
 * destino. E o "cobrir": preenche o painel sem esticar a imagem.
 */
export function cobrir(regiao: Rect | null | undefined, larg: number, alt: number, destW: number, destH: number): Px {
  const r = limitarRect(regiao ?? { x: 0, y: 0, w: 1, h: 1 });
  const rx = r.x * larg, ry = r.y * alt, rw = r.w * larg, rh = r.h * alt;
  const alvo = destW / destH;
  let w = rw, h = rh;
  if (rw / rh > alvo) w = rh * alvo; else h = rw / alvo;
  w = Math.min(par(w), Math.floor(larg / 2) * 2);
  h = Math.min(par(h), Math.floor(alt / 2) * 2);
  const x = limitar(Math.round(rx + (rw - w) / 2), 0, larg - w);
  const y = limitar(Math.round(ry + (rh - h) / 2), 0, alt - h);
  return { x, y, w, h };
}

/** Altura da faixa da camera que mostra a caixa inteira, sem cortar nada. */
export function fracaoQueCabe(cam: Rect, larg: number, alt: number): number {
  const proporcao = (cam.w * larg) / (cam.h * alt);
  return limitar(LARGURA / proporcao / ALTURA, 0.2, 0.55);
}

export function calcular(layout: Layout, larg: number, alt: number, edicao: Edicao = {}): Geometria {
  const g = calcularPaineis(layout, larg, alt, edicao);
  const L = larg || 1280, A = alt || 720;
  if (!edicao.tapar) return { ...g, tapar: null };
  const r = limitarRect(edicao.tapar);
  const w = par(r.w * L), h = par(r.h * A);
  return { ...g, tapar: { x: Math.min(par(r.x * L), L - w), y: Math.min(par(r.y * A), A - h), w, h } };
}

function calcularPaineis(layout: Layout, larg: number, alt: number, edicao: Edicao): Omit<Geometria, "tapar"> {
  const L = larg || 1280;
  const A = alt || 720;
  const proporcao = L / A;
  const gancho = (padrao: number | null) =>
    edicao.ganchoSegundos === undefined ? padrao : edicao.ganchoSegundos === 0 ? null : edicao.ganchoSegundos;

  if (layout === "facecam" && edicao.cam) {
    const camH = par(ALTURA * limitar(edicao.camFracao ?? CAM_FRACAO_PADRAO, 0.2, 0.55));
    const jogoH = ALTURA - camH;
    const camEmBaixo = (edicao.camPos ?? "baixo") === "baixo";
    const cam: Painel = {
      nome: "cam",
      origem: cobrir(edicao.cam, L, A, LARGURA, camH),
      destino: { x: 0, y: camEmBaixo ? jogoH : 0, w: LARGURA, h: camH },
    };
    const jogo: Painel = {
      nome: "jogo",
      origem: cobrir(edicao.jogo, L, A, LARGURA, jogoH),
      destino: { x: 0, y: camEmBaixo ? 0 : camH, w: LARGURA, h: jogoH },
    };
    return {
      layout,
      fundo: false,
      paineis: camEmBaixo ? [jogo, cam] : [cam, jogo],
      // Legenda na emenda entre os dois paineis: nao tampa nem o rosto nem a acao.
      legendaY: camEmBaixo ? jogoH : camH,
      ganchoY: 70,
      ganchoAte: gancho(4),
      // Credito colado no topo da camera, discreto, longe da legenda e da acao do jogo.
      creditoTopo: (camEmBaixo ? jogoH : 0) + 18,
    };
  }

  // Video ja vertical, ou pediu tela cheia: um painel so.
  if (layout === "cheio" || proporcao < 0.8) {
    return {
      layout: "cheio",
      fundo: false,
      paineis: [{ nome: "jogo", origem: cobrir(edicao.jogo, L, A, LARGURA, ALTURA), destino: { x: 0, y: 0, w: LARGURA, h: ALTURA } }],
      legendaY: 1340,
      ganchoY: 230,
      ganchoAte: gancho(null),
    };
  }

  // Desfocado: o video borrado de fundo e ele inteiro no centro, com zoom pra
  // gameplay nao ficar miudo no celular.
  const zoom = limitar(edicao.zoom ?? (proporcao > 1.2 ? 1.25 : 1), 1, 2.2);
  const destH = Math.min(par((LARGURA * zoom) / proporcao), ALTURA);
  const topo = par((ALTURA - destH) / 2);
  return {
    layout: "desfocado",
    fundo: true,
    // Aqui o recorte do jogo e sempre o centro: quem controla o enquadramento e o zoom.
    paineis: [{ nome: "jogo", origem: cobrir(null, L, A, LARGURA, destH), destino: { x: 0, y: topo, w: LARGURA, h: destH } }],
    legendaY: Math.min(ALTURA - 330, topo + destH + 150),
    ganchoY: Math.max(120, topo - 260),
    ganchoAte: gancho(null),
  };
}
