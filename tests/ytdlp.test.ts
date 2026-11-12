import { describe, expect, it } from "vitest";
import { argsDownload, lerPlaylist, plataformaDaUrl, segundos, urlDeBusca } from "../src/server/ferramentas/ytdlp.ts";

describe("urlDeBusca", () => {
  it("canal da Twitch vira clips da semana", () => {
    expect(urlDeBusca("https://www.twitch.tv/gaules/")).toBe("https://www.twitch.tv/gaules/clips?filter=clips&range=7d");
  });
  it("canal do YouTube vira a aba de videos", () => {
    expect(urlDeBusca("https://www.youtube.com/@casimito")).toBe("https://www.youtube.com/@casimito/videos");
  });
  it("URL especifica fica como esta", () => {
    expect(urlDeBusca("https://www.youtube.com/watch?v=abc")).toBe("https://www.youtube.com/watch?v=abc");
  });
});

describe("plataformaDaUrl", () => {
  it("reconhece as plataformas", () => {
    expect(plataformaDaUrl("https://clips.twitch.tv/Abc")).toBe("twitch");
    expect(plataformaDaUrl("https://youtu.be/x")).toBe("youtube");
    expect(plataformaDaUrl("https://kick.com/x")).toBe("kick");
    expect(plataformaDaUrl("https://site.com")).toBe("outro");
  });
});

describe("lerPlaylist", () => {
  it("le entries do flat-playlist e ignora as sem URL", () => {
    const json = JSON.stringify({ entries: [
      { url: "https://clips.twitch.tv/A", title: "insano", view_count: 1200, duration: 30, timestamp: 1763000000 },
      { id: "sem-url" },
    ] });
    const r = lerPlaylist(json);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ url: "https://clips.twitch.tv/A", titulo: "insano", views: 1200, duracao: 30 });
    expect(r[0]!.publicadoEm).toMatch(/^2025-/);
  });
});

describe("segundos", () => {
  it("aceita h:mm:ss, mm:ss e segundos", () => {
    expect(segundos("1:02:03")).toBe(3723);
    expect(segundos("62:03")).toBe(3723);
    expect(segundos("45")).toBe(45);
    expect(() => segundos("x")).toThrow();
  });
});

describe("argsDownload", () => {
  it("estudo baixa so audio; trecho vira download-sections", () => {
    expect(argsDownload("u", "/d/1", { soAudio: true })).toContain("ba[ext=m4a]/ba/b");
    expect(argsDownload("https://www.twitch.tv/videos/1", "/d/1", { trecho: [60, 120] })).toContain("*60-120");
  });
  it("no YouTube o trecho nao vai pro yt-dlp: baixa inteiro e corta no PC", async () => {
    const { argsCorteLocal, cortaLocal } = await import("../src/server/ferramentas/ytdlp.ts");
    const yt = "https://www.youtube.com/watch?v=abc";
    expect(cortaLocal(yt)).toBe(true);
    expect(cortaLocal("https://www.twitch.tv/videos/1")).toBe(false);
    expect(argsDownload(yt, "/d/1", { trecho: [60, 120] })).not.toContain("--download-sections");
    const corte = argsCorteLocal("in.mp4", "out.mp4", [600, 660]);
    expect(corte.slice(corte.indexOf("-ss"), corte.indexOf("-ss") + 2)).toEqual(["-ss", "600"]);
    expect(corte.slice(corte.indexOf("-t"), corte.indexOf("-t") + 2)).toEqual(["-t", "60"]);
  });
});

describe("canalDaUrl", () => {
  it("pega o streamer do clip da Twitch, nao quem clipou", async () => {
    const { canalDaUrl } = await import("../src/server/ferramentas/ytdlp.ts");
    expect(canalDaUrl("https://www.twitch.tv/kaicenat/clip/HappyPatientCardPrimeMe-J-Qx6tocmjBMyXZy")).toBe("kaicenat");
    expect(canalDaUrl("https://clips.twitch.tv/HappyPatient")).toBeNull();
    expect(canalDaUrl("https://www.youtube.com/watch?v=x")).toBeNull();
  });
});
