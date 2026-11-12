import "dotenv/config";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function num(chave: string, padrao: number): number {
  const v = Number(process.env[chave]);
  return Number.isFinite(v) && v > 0 ? v : padrao;
}

/** Usa o binario do caminho fixo se existir, senao confia no PATH. */
function binario(env: string, fixo: string, nome: string): string {
  if (process.env[env]) return process.env[env]!;
  return existsSync(fixo) ? fixo : nome;
}

export const raizProjeto = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Fora do OneDrive de proposito: video pesa e SQLite aberto sincronizando corrompe.
const dados = process.env.SKC_DATA || join(homedir(), ".sk-cortes");

export const config = {
  porta: num("SKC_PORT", 5191),
  dados,
  dbPath: join(dados, "sk-cortes.db"),
  pastas: {
    videos: join(dados, "videos"),
    transcricoes: join(dados, "transcricoes"),
    renders: join(dados, "renders"),
    narracoes: join(dados, "narracoes"),
  },
  estrategia: join(raizProjeto, "estrategia"),
  workers: join(raizProjeto, "workers"),
  ffmpeg: binario("FFMPEG", "C:/ffmpeg/bin/ffmpeg.exe", "ffmpeg"),
  ffprobe: binario("FFPROBE", "C:/ffmpeg/bin/ffprobe.exe", "ffprobe"),
  ytdlp: process.env.YTDLP || "yt-dlp",
  python: process.env.PYTHON || "python",
  whisperModelo: process.env.WHISPER_MODELO || "small",
};
