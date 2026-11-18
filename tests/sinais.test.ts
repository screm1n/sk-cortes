import { describe, expect, it } from "vitest";
import { DetectorAudio, DetectorChat, mediana } from "../src/server/aovivo/sinais.ts";

describe("mediana", () => {
  it("par e impar", () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
    expect(mediana([])).toBe(0);
  });
});

/** Simula um chat: `porBalde` mensagens em cada balde de 5 s. */
function simular(d: DetectorChat, baldes: { n: number; texto?: string }[]) {
  const picos = [];
  let t = 1_000_000_000;
  for (const b of baldes) {
    for (let i = 0; i < b.n; i++) d.registrar(b.texto ?? "oi", t + i);
    t += 5000;
    const p = d.verificar(t + 10);
    if (p) picos.push(p);
  }
  return picos;
}

describe("DetectorChat", () => {
  it("nao julga antes de 1 minuto de chat", () => {
    expect(simular(new DetectorChat(), [{ n: 2 }, { n: 2 }, { n: 80 }])).toHaveLength(0);
  });
  it("chat estavel nao dispara", () => {
    expect(simular(new DetectorChat(), Array.from({ length: 40 }, () => ({ n: 6 })))).toHaveLength(0);
  });
  it("explosao de mensagens dispara uma vez so (espera 40 s)", () => {
    const baldes = [...Array.from({ length: 20 }, () => ({ n: 5 })), { n: 40 }, { n: 40 }, { n: 5 }];
    const p = simular(new DetectorChat(), baldes);
    expect(p).toHaveLength(1);
    expect(p[0]!.forca).toBeGreaterThan(5);
  });
  it("risada em massa dispara mesmo sem muita mensagem a mais", () => {
    const baldes = [...Array.from({ length: 20 }, () => ({ n: 6 })), { n: 12, texto: "KKKKKKKK" }];
    const p = simular(new DetectorChat(), baldes);
    expect(p).toHaveLength(1);
    expect(p[0]!.detalhe).toContain("risadas");
  });
});

describe("DetectorAudio", () => {
  it("grito bem acima do normal vira pico; volume normal nao", () => {
    const d = new DetectorAudio();
    for (let i = 0; i < 12; i++) expect(d.registrar(-24 + (i % 2), i * 4)).toBeNull();
    expect(d.registrar(-14, 50)).not.toBeNull();
    expect(d.registrar(-14, 60)).toBeNull(); // dentro da espera
  });
  it("silencio total nao conta", () => {
    const d = new DetectorAudio();
    for (let i = 0; i < 12; i++) d.registrar(-60, i * 4);
    expect(d.registrar(-40, 60)).toBeNull();
  });
});
