import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import * as repo from "./db/repo.ts";

/*
 * O caderno de estrategia vive em arquivos (estrategia/), nao no banco: o Claude
 * le e escreve direto, e da pra versionar no git. O banco so guarda qual video de
 * estudo virou qual anotacao.
 */

export const caminhoRegras = () => join(config.estrategia, "REGRAS.md");
export const pastaCaderno = () => join(config.estrategia, "caderno");

export function lerRegras(): string {
  return existsSync(caminhoRegras()) ? readFileSync(caminhoRegras(), "utf8") : "";
}

export function salvarRegras(texto: string): void {
  mkdirSync(config.estrategia, { recursive: true });
  writeFileSync(caminhoRegras(), texto, "utf8");
}

export interface Estudo {
  id: number;
  url: string;
  titulo: string | null;
  autor: string | null;
  status: string;
  erro: string | null;
  analise: string | null;
  criadoEm: string;
}

export function listarEstudos(): Estudo[] {
  return repo.listarVideos({ tipo: "estudo" }).map((v) => ({
    id: v.id, url: v.url, titulo: v.titulo, autor: v.autor, status: v.status, erro: v.erro,
    analise: v.analise && existsSync(v.analise) ? readFileSync(v.analise, "utf8") : null,
    criadoEm: v.criadoEm,
  }));
}
