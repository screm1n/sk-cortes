import { spawn } from "node:child_process";

export interface Saida { codigo: number; stdout: string; stderr: string }

/**
 * Roda um binario sem shell (argumentos nunca passam por interpretacao de shell,
 * entao URL com & ou titulo com aspas nao quebra nada). `linha` recebe stdout e
 * stderr linha a linha pra quem quiser ler progresso.
 */
export function rodar(
  bin: string,
  args: string[],
  opcoes: { cwd?: string; linha?: (l: string) => void; env?: Record<string, string> } = {}
): Promise<Saida> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, {
      cwd: opcoes.cwd,
      // PYTHON_COLORS/NO_COLOR: sem codigo de cor ANSI nas mensagens de erro que vao pro painel.
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PYTHON_COLORS: "0", NO_COLOR: "1", ...opcoes.env },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let resto = "";
    const porLinha = (txt: string) => {
      if (!opcoes.linha) return;
      resto += txt;
      const partes = resto.split(/\r?\n|\r/);
      resto = partes.pop() ?? "";
      for (const l of partes) if (l.trim()) opcoes.linha(l);
    };
    p.stdout.on("data", (d: Buffer) => { const t = d.toString("utf8"); stdout += t; porLinha(t); });
    p.stderr.on("data", (d: Buffer) => { const t = d.toString("utf8"); stderr += t; porLinha(t); });
    p.on("error", (e) => reject(new Error(`nao consegui rodar ${bin}: ${e.message}`)));
    p.on("close", (codigo) => resolve({ codigo: codigo ?? 1, stdout, stderr }));
  });
}

/** Igual rodar, mas falha com as ultimas linhas do erro se o codigo nao for 0. */
export async function rodarOk(bin: string, args: string[], opcoes?: Parameters<typeof rodar>[2]): Promise<Saida> {
  const s = await rodar(bin, args, opcoes);
  if (s.codigo !== 0) {
    const fim = (s.stderr || s.stdout).trim().split(/\r?\n/).slice(-6).join("\n");
    throw new Error(`${bin.split(/[\\/]/).pop()} saiu com ${s.codigo}: ${fim}`);
  }
  return s;
}
