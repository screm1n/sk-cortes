import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { usarDb } from "../src/server/db/client.ts";
import * as repo from "../src/server/db/repo.ts";
import { importarMomentos } from "../src/server/momentos.ts";

let videoId: number;
let bloqueadoId: number;

beforeEach(() => {
  usarDb(new Database(":memory:"));
  videoId = repo.inserirVideo({ url: "https://clips.twitch.tv/A", duracao: 60 }).video.id;
  repo.editarVideo(videoId, { status: "transcrito" });
  const f = repo.criarFonte({ nome: "fechado", plataforma: "twitch", url: "https://twitch.tv/fechado",
    idioma: "pt", origem: "br", libera: "nao", facecam: null, notas: null });
  bloqueadoId = repo.inserirVideo({ url: "https://clips.twitch.tv/B", fonteId: f.id }).video.id;
});

const base = { inicio: 10, fim: 30, gancho: "Ele nao esperava isso", nota: 8 };

describe("importarMomentos", () => {
  it("grava o momento e marca o video como analisado", () => {
    const r = importarMomentos([{ video_id: videoId, ...base, legendas: [{ inicio: 10, fim: 12, texto: "olha" }] }]);
    expect(r.erros).toEqual([]);
    expect(r.inseridos).toHaveLength(1);
    expect(repo.getVideo(videoId)!.status).toBe("analisado");
    expect(repo.getMomento(r.inseridos[0]!)!.legendas).toEqual([{ inicio: 10, fim: 12, texto: "olha" }]);
  });
  it("recusa travessao com mensagem clara", () => {
    const r = importarMomentos([{ video_id: videoId, ...base, gancho: "Ele caiu — e riu" }]);
    expect(r.erros[0]).toContain("travessao");
  });
  it("recusa fonte que nao libera cortes", () => {
    expect(importarMomentos([{ video_id: bloqueadoId, ...base }]).erros[0]).toContain("nao libera");
  });
  it("recusa corte que passa do fim do video ou dura demais", () => {
    expect(importarMomentos([{ video_id: videoId, ...base, fim: 80 }]).erros[0]).toContain("passa da duracao");
    expect(importarMomentos([{ video_id: videoId, ...base, inicio: 0, fim: 1 }]).erros[0]).toContain("fora de 3 a 180");
  });
  it("descarte marca analisado sem criar momento", () => {
    const r = importarMomentos([{ video_id: videoId, descartar: true, porque: "nao e GTA" }]);
    expect(r.descartados).toEqual([videoId]);
    expect(repo.listarMomentos()).toHaveLength(0);
  });
  it("aceita objeto unico alem de lista", () => {
    expect(importarMomentos({ video_id: videoId, ...base }).inseridos).toHaveLength(1);
  });
});
