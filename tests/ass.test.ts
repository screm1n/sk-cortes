import { describe, expect, it } from "vitest";
import { agrupar, escapar, frasesParaPalavras, gerarAss, tempoAss } from "../src/server/fabrica/ass.ts";

const p = (i: number, f: number, w: string) => ({ i, f, w });

describe("tempoAss", () => {
  it("formata em h:mm:ss.cc", () => {
    expect(tempoAss(0)).toBe("0:00:00.00");
    expect(tempoAss(61.5)).toBe("0:01:01.50");
    expect(tempoAss(3725.257)).toBe("1:02:05.26");
  });
  it("nunca gera 60 segundos por arredondamento", () => {
    expect(tempoAss(59.999)).not.toContain(":60.");
  });
});

describe("agrupar", () => {
  it("no maximo 3 palavras por bloco, em caixa alta e sem virgula", () => {
    const b = agrupar([p(0, 0.2, "ele"), p(0.2, 0.4, "pulou,"), p(0.4, 0.6, "do"), p(0.6, 0.8, "predio")]);
    expect(b.map((x) => x.map((y) => y.w))).toEqual([["ELE", "PULOU", "DO"], ["PREDIO"]]);
  });
  it("quebra em pausa longa e em fim de frase", () => {
    const b = agrupar([p(0, 0.2, "oi."), p(0.3, 0.5, "mano"), p(2, 2.2, "olha")]);
    expect(b.length).toBe(3);
  });
  it("mantem ? e !", () => {
    expect(agrupar([p(0, 1, "serio?!")])[0]![0]!.w).toBe("SERIO?!");
  });
});

describe("frasesParaPalavras", () => {
  it("reparte a frase traduzida e desloca pro inicio do corte", () => {
    const ps = frasesParaPalavras([{ inicio: 10, fim: 12, texto: "ele caiu" }], 10, 20);
    expect(ps[0]!.i).toBe(0);
    expect(ps[1]!.f).toBeCloseTo(2);
  });
  it("corta frase que passa do fim do corte", () => {
    const ps = frasesParaPalavras([{ inicio: 18, fim: 22, texto: "a b" }], 10, 20);
    expect(ps.at(-1)!.f).toBeCloseTo(10);
  });
});

describe("gerarAss", () => {
  const ass = gerarAss({
    palavras: [p(0, 0.3, "olha"), p(0.3, 0.6, "isso")], duracao: 5, legendaY: 1400,
    gancho: "Ele nao esperava {isso}", credito: "via @fulano · twitch", marca: "@perfil",
  });
  it("tem cabecalho 1080x1920", () => {
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
  });
  it("destaca a palavra atual em amarelo", () => {
    expect(ass).toContain("{\\c&H4DE1FF&}OLHA{\\c&HFFFFFF&} ISSO");
    expect(ass).toContain("OLHA {\\c&H4DE1FF&}ISSO{\\c&HFFFFFF&}");
  });
  it("gancho em caixa alta e sem chaves que abririam tag", () => {
    expect(ass).toContain("ELE NAO ESPERAVA ISSO");
  });
  it("credito e marca entram", () => {
    expect(ass).toContain("via @fulano · twitch");
    expect(ass).toContain("@perfil");
  });
  it("escapar remove chave e barra invertida", () => {
    expect(escapar("a{b}\\c")).toBe("ab/c");
  });
});

describe("frases traduzidas", () => {
  it("bloco nunca mistura duas frases", () => {
    const ps = frasesParaPalavras([{ inicio: 0, fim: 2, texto: "que coisa" }, { inicio: 2, fim: 4, texto: "ele caiu" }], 0, 10);
    expect(agrupar(ps).map((b) => b.map((x) => x.w).join(" "))).toEqual(["QUE COISA", "ELE CAIU"]);
  });
});

describe("fala original", () => {
  it("bloco fecha no fim de cada fala do Whisper", async () => {
    const { palavrasDoTrecho } = await import("../src/server/ferramentas/midia.ts");
    const t = { idioma: "pt", duracao: 10, segmentos: [
      { i: 0, f: 1, t: "acabou o freio", p: [{ i: 0, f: 0.3, w: "acabou" }, { i: 0.3, f: 0.5, w: "o" }, { i: 0.5, f: 1, w: "freio" }] },
      { i: 1.1, f: 2, t: "o que", p: [{ i: 1.1, f: 1.3, w: "o" }, { i: 1.3, f: 2, w: "que" }] },
    ] };
    expect(agrupar(palavrasDoTrecho(t, 0, 10)).map((b) => b.map((x) => x.w).join(" "))).toEqual(["ACABOU O FREIO", "O QUE"]);
  });
});

describe("estilo da legenda", () => {
  it("cor, fonte, tamanho, altura e minusculas vao pro .ass", async () => {
    const { gerarAss, corAss } = await import("../src/server/fabrica/ass.ts");
    expect(corAss("#3BFF6B")).toBe("&H6BFF3B&");
    const ass = gerarAss({
      palavras: [{ i: 0, f: 0.5, w: "olha" }], duracao: 2, legendaY: 1400,
      estilo: { cor: "#3BFF6B", fonte: "Impact", tamanho: 1.2, deslocar: -100, maiusculas: false },
    });
    expect(ass).toContain("Style: Legenda,Impact,103,");
    expect(ass).toContain("\\pos(540,1300)}{\\c&H6BFF3B&}olha");
  });
});
