import { describe, expect, it } from "vitest";
import { argsFfmpeg, planejar } from "../src/server/fabrica/filtros.ts";
import { calcular, cobrir, fracaoQueCabe } from "../src/compartilhado/geometria.ts";

const CAM = { x: 0, y: 0, w: 0.2375, h: 0.2389 };

describe("geometria", () => {
  it("cobrir pega o maior recorte centralizado na proporcao do destino", () => {
    // quadro 1280x720 inteiro num painel 1080x1228 (mais alto que largo): corta as laterais
    const r = cobrir(null, 1280, 720, 1080, 1228);
    expect(r.h).toBe(720);
    expect(r.w).toBe(634);
    expect(r.x).toBe(323);
  });
  it("recorte nunca sai do quadro", () => {
    const r = cobrir({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 1280, 720, 1080, 600);
    expect(r.x + r.w).toBeLessThanOrEqual(1280);
    expect(r.y + r.h).toBeLessThanOrEqual(720);
  });
  it("tela dividida: camera embaixo por padrao, paineis fecham 1920", () => {
    const g = calcular("facecam", 1280, 720, { cam: CAM });
    expect(g.paineis.map((p) => p.nome)).toEqual(["jogo", "cam"]);
    expect(g.paineis[0]!.destino.h + g.paineis[1]!.destino.h).toBe(1920);
    expect(g.paineis[1]!.destino.y).toBe(g.paineis[0]!.destino.h);
    expect(g.legendaY).toBe(g.paineis[0]!.destino.h);
    expect(g.ganchoAte).toBe(4);
  });
  it("camera em cima inverte a ordem", () => {
    const g = calcular("facecam", 1280, 720, { cam: CAM, camPos: "cima", camFracao: 0.3 });
    expect(g.paineis.map((p) => p.nome)).toEqual(["cam", "jogo"]);
    expect(g.paineis[0]!.destino).toEqual({ x: 0, y: 0, w: 1080, h: 576 });
  });
  it("ganchoSegundos 0 = o video todo", () => {
    expect(calcular("facecam", 1280, 720, { cam: CAM, ganchoSegundos: 0 }).ganchoAte).toBeNull();
    expect(calcular("desfocado", 1280, 720, { ganchoSegundos: 3 }).ganchoAte).toBe(3);
  });
  it("fracaoQueCabe mostra a camera inteira", () => {
    // camera 304x172 px (16:9): 1080/1.767 = 611 px de altura = 0.318 da tela
    expect(fracaoQueCabe(CAM, 1280, 720)).toBeCloseTo(0.318, 2);
  });
});

describe("planejar", () => {
  it("16:9 desfocado: video ampliado no centro e legenda abaixo", () => {
    const p = planejar("desfocado", 1280, 720);
    expect(p.filtro).toContain("crop=1024:720:128:0,scale=1080:760[p0]");
    expect(p.filtro).toContain("[fundo][p0]overlay=0:580");
    expect(p.filtro).toMatch(/subtitles=legenda\.ass:fontsdir=fontes\[v\]$/);
    expect(p.legendaY).toBeGreaterThan(1340);
    expect(p.ganchoAte).toBeNull();
  });
  it("video vertical ocupa a tela toda mesmo pedindo desfocado", () => {
    const p = planejar("desfocado", 720, 1280);
    expect(p.filtro).toContain("crop=720:1280:0:0,scale=1080:1920[p0]");
    expect(p.filtro).not.toContain("overlay");
  });
  it("tela dividida empilha os dois paineis", () => {
    const p = planejar("facecam", 1280, 720, { cam: CAM, camPos: "baixo" });
    expect(p.filtro).toContain("[0:v]split=2[s0][s1]");
    expect(p.filtro).toContain("[p0][p1]vstack=inputs=2");
    // p1 e a camera: recorte dentro do canto de cima a esquerda
    expect(p.filtro).toMatch(/\[s1\]crop=\d+:\d+:\d+:0,scale=1080:692\[p1\]/);
  });
  it("tela dividida sem camera marcada cai no desfocado", () => {
    expect(planejar("facecam", 1920, 1080, {}).filtro).toContain("overlay");
  });
});

describe("argsFfmpeg", () => {
  it("video sem audio ganha faixa muda (concat precisa)", () => {
    const a = argsFfmpeg({ entrada: "x.mp4", inicio: 1, duracao: 5, filtro: "[0:v]null[v]", temAudio: false, saida: "o.mp4" });
    expect(a).toContain("anullsrc=r=48000:cl=stereo");
    expect(a.join(" ")).toContain("[1:a]anull[aout]");
  });
  it("narracao abafa o audio original e repete o fundo", () => {
    const a = argsFfmpeg({ entrada: "x.mp4", inicio: 0, duracao: 5, filtro: "[0:v]null[v]", temAudio: true, saida: "o.mp4", narracao: "n.mp3" });
    expect(a.join(" ")).toContain("[0:a]volume=0.07");
    expect(a).toContain("-stream_loop");
  });
});

describe("borrar legenda do original", () => {
  it("borra a regiao antes de montar os paineis", () => {
    const p = planejar("desfocado", 1280, 720, { tapar: { x: 0.25, y: 0.8, w: 0.5, h: 0.1 } });
    expect(p.filtro.startsWith("[0:v]split=2[orig][ptap];[ptap]crop=640:72:320:576,boxblur=20:4:10:4[tap];[orig][tap]overlay=320:576[base];[base]split=2")).toBe(true);
  });
  it("sem tapar, nada muda", () => {
    expect(planejar("desfocado", 1280, 720).filtro.startsWith("[0:v]split=2[s0][s1]")).toBe(true);
  });
});
