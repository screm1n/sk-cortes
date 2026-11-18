/*
 * Detectores de "momento quente" numa live. Funcoes puras (testadas): quem alimenta
 * e o gravador. Dois sinais, porque cada um falha num caso diferente:
 *  - chat: explode de mensagem e de risada logo depois de algo bom (so Twitch, por enquanto);
 *  - audio: o streamer grita. Funciona em qualquer plataforma, mas pega susto e musica alta.
 */

export const RISADA = /(k{3,}|kkk|KEKW|OMEGALUL|LUL|LMAO|ICANT|haha|rsrs|😂|🤣|💀)/i;

export function mediana(xs: number[]): number {
  if (!xs.length) return 0;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m]! : (o[m - 1]! + o[m]!) / 2;
}

export interface Pico {
  /** Hora (ms) em que o pico aconteceu no relogio do PC. */
  em: number;
  /** Quantas vezes acima do normal. */
  forca: number;
  detalhe: string;
}

const BALDE_MS = 5000;
const AQUECIMENTO = 12; // 1 minuto de chat antes de comecar a julgar
const JANELA = 60; // normal = mediana dos ultimos 5 minutos
const ESPERA_MS = 40000; // dois picos seguidos sao o mesmo momento

interface Balde { n: number; risos: number; msgs: string[] }

export class DetectorChat {
  private baldes = new Map<number, Balde>();
  private primeiro: number | null = null;
  private ultimoAvaliado = -1;
  private calmoAte = 0;

  registrar(msg: string, agora: number): void {
    const k = Math.floor(agora / BALDE_MS);
    if (this.primeiro === null) this.primeiro = k;
    const b = this.baldes.get(k) ?? { n: 0, risos: 0, msgs: [] };
    b.n++;
    if (RISADA.test(msg)) b.risos++;
    if (b.msgs.length < 8) b.msgs.push(msg.slice(0, 80));
    this.baldes.set(k, b);
  }

  /** Avalia o ultimo balde fechado. Chame de tempos em tempos. */
  verificar(agora: number): Pico | null {
    const k = Math.floor(agora / BALDE_MS) - 1;
    if (k <= this.ultimoAvaliado || this.primeiro === null) return null;
    this.ultimoAvaliado = k;
    for (const chave of this.baldes.keys()) if (chave < k - JANELA - 2) this.baldes.delete(chave);
    if (k - this.primeiro < AQUECIMENTO) return null;

    const atual = this.baldes.get(k) ?? { n: 0, risos: 0, msgs: [] };
    const antes = Array.from({ length: Math.min(JANELA, k - this.primeiro) }, (_, i) => this.baldes.get(k - 1 - i));
    const normalN = mediana(antes.map((b) => b?.n ?? 0));
    const normalR = mediana(antes.map((b) => b?.risos ?? 0));
    const fim = (k + 1) * BALDE_MS;
    if (fim < this.calmoAte) return null;

    const explodiu = atual.n >= Math.max(8, normalN * 2.5 + 3);
    const riu = atual.risos >= Math.max(6, normalR * 3 + 3);
    if (!explodiu && !riu) return null;

    this.calmoAte = fim + ESPERA_MS;
    const forca = Math.max(atual.n / Math.max(1, normalN), atual.risos / Math.max(1, normalR));
    const tipo = riu ? `${atual.risos} risadas` : `${atual.n} mensagens`;
    return { em: fim, forca: Math.round(forca * 10) / 10, detalhe: `${tipo} em 5 s (normal ${Math.round(normalN)}): ${atual.msgs.slice(0, 4).join(" | ")}` };
  }
}

/** Volume (RMS em dB) de cada pedaco gravado. Pico = bem acima do normal da live. */
export class DetectorAudio {
  private historico: number[] = [];
  private calmoAte = -Infinity;

  /** `t` = tempo de gravacao (s) do meio do pedaco. */
  registrar(rms: number, t: number): { forca: number; detalhe: string } | null {
    const normal = mediana(this.historico);
    const pronto = this.historico.length >= 10;
    this.historico.push(rms);
    if (this.historico.length > 75) this.historico.shift();
    if (!pronto || t < this.calmoAte || rms < -30) return null;
    const acima = rms - normal;
    if (acima < 7) return null;
    this.calmoAte = t + 40;
    return { forca: Math.round(acima * 10) / 10, detalhe: `volume ${acima.toFixed(0)} dB acima do normal (grito, susto ou explosão)` };
  }
}
