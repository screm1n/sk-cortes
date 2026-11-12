import { EventEmitter } from "node:events";

/**
 * Fila em processo, um job por vez. Serial de proposito: Whisper e ffmpeg ja usam
 * a CPU inteira; dois ao mesmo tempo so deixaria os dois mais lentos.
 */

export type TipoJob = "buscar" | "baixar" | "transcrever" | "render";
export type StatusJob = "fila" | "rodando" | "ok" | "erro" | "cancelado";

export interface Progresso {
  atual: number;
  total: number;
  mensagem: string;
}

export interface Job {
  id: number;
  tipo: TipoJob;
  titulo: string;
  status: StatusJob;
  progresso: Progresso;
  resultado: unknown;
  erro: string | null;
  criadoEm: string;
  terminadoEm: string | null;
}

export interface Contexto {
  progresso(atual: number, total: number, mensagem: string): void;
  /** Job checa isso nos pontos seguros pra parar sem deixar trabalho pela metade. */
  cancelado(): boolean;
}

type Tarefa = (ctx: Contexto) => Promise<unknown>;

const eventos = new EventEmitter();
const jobs = new Map<number, Job>();
const fila: { job: Job; tarefa: Tarefa }[] = [];
const cancelados = new Set<number>();

let proximoId = 1;
let rodando = false;

function emitir(job: Job): void {
  eventos.emit("update", job);
}

export function enfileirar(tipo: TipoJob, titulo: string, tarefa: Tarefa): Job {
  const job: Job = {
    id: proximoId++,
    tipo,
    titulo,
    status: "fila",
    progresso: { atual: 0, total: 0, mensagem: "na fila" },
    resultado: null,
    erro: null,
    criadoEm: new Date().toISOString(),
    terminadoEm: null,
  };
  jobs.set(job.id, job);
  fila.push({ job, tarefa });
  emitir(job);
  void bombear();
  return job;
}

async function bombear(): Promise<void> {
  if (rodando) return;
  const proximo = fila.shift();
  if (!proximo) return;

  rodando = true;
  const { job, tarefa } = proximo;

  if (cancelados.has(job.id)) {
    job.status = "cancelado";
    job.terminadoEm = new Date().toISOString();
    emitir(job);
    rodando = false;
    void bombear();
    return;
  }

  job.status = "rodando";
  job.progresso = { atual: 0, total: 0, mensagem: "comecando" };
  emitir(job);

  const ctx: Contexto = {
    progresso(atual, total, mensagem) {
      job.progresso = { atual, total, mensagem };
      emitir(job);
    },
    cancelado: () => cancelados.has(job.id),
  };

  try {
    job.resultado = await tarefa(ctx);
    job.status = cancelados.has(job.id) ? "cancelado" : "ok";
  } catch (e) {
    job.status = "erro";
    job.erro = e instanceof Error ? e.message : String(e);
  } finally {
    job.terminadoEm = new Date().toISOString();
    emitir(job);
    rodando = false;
    void bombear();
  }
}

export function cancelar(id: number): boolean {
  const job = jobs.get(id);
  if (!job || job.status === "ok" || job.status === "erro") return false;
  cancelados.add(id);
  return true;
}

export function getJob(id: number): Job | undefined {
  return jobs.get(id);
}

export function listJobs(limite = 20): Job[] {
  return [...jobs.values()].sort((a, b) => b.id - a.id).slice(0, limite);
}

export function jobAtivo(): Job | undefined {
  return [...jobs.values()].find((j) => j.status === "rodando" || j.status === "fila");
}

export function assinar(fn: (job: Job) => void): () => void {
  eventos.on("update", fn);
  return () => eventos.off("update", fn);
}

export const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
