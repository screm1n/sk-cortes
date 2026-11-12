import { useEffect, useState } from "react";
import { api, copiar, tempo, type Estado, type Video } from "../lib/api.ts";

/*
 * O passo "escolher os momentos" tem tres jeitos de ser feito. A escolha fica salva
 * nos Ajustes (chave "cerebro") e da pra trocar aqui mesmo, a qualquer hora.
 */

export type Cerebro = "claude" | "codex" | "manual";

export const NOME_CEREBRO: Record<Cerebro, string> = { claude: "Claude", codex: "Codex", manual: "você" };

const OPCOES: { id: Cerebro; rotulo: string }[] = [
  { id: "claude", rotulo: "Claude" },
  { id: "codex", rotulo: "Codex" },
  { id: "manual", rotulo: "Na mão" },
];

function Copiar({ texto, grande }: { texto: string; grande?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <button className={`comando ${grande ? "comando-grande" : ""}`} onClick={() => { void copiar(texto); setOk(true); setTimeout(() => setOk(false), 1500); }}>
      {texto} <small>{ok ? "copiado" : "clique pra copiar"}</small>
    </button>
  );
}

export function Escolha({ estado, aoMudar, editar, grande }: {
  estado: Estado | null; aoMudar: () => void; editar: (momentoId: number) => void; grande?: boolean;
}) {
  const salvo = (estado?.ajustes.cerebro ?? "claude") as Cerebro;
  const [cerebro, setCerebro] = useState<Cerebro>(salvo);
  const [videos, setVideos] = useState<Video[]>([]);
  const [erro, setErro] = useState("");
  const n = estado?.contagens.aguardandoClaude ?? 0;

  useEffect(() => { setCerebro(salvo); }, [salvo]);
  useEffect(() => {
    if (cerebro === "manual") api.videos("corte", "transcrito").then(setVideos).catch(() => {});
  }, [cerebro, n]);

  const trocar = async (c: Cerebro) => {
    setCerebro(c);
    try { await api.salvarAjustes({ cerebro: c }); aoMudar(); } catch (e) { setErro((e as Error).message); }
  };

  const cortar = async (v: Video) => {
    setErro("");
    try { editar((await api.corteManual(v.id)).id); aoMudar(); } catch (e) { setErro((e as Error).message); }
  };

  return (
    <div className={grande ? "escolha" : "chamada escolha"}>
      <div className="escolha-topo">
        {grande ? <h2>{n} {n === 1 ? "vídeo esperando" : "vídeos esperando"} os momentos</h2>
          : <b>{n} {n === 1 ? "vídeo esperando" : "vídeos esperando"} os momentos.</b>}
        <div className="segmento escolha-quem" role="group" aria-label="Quem escolhe os momentos">
          {OPCOES.map((o) => <button key={o.id} aria-pressed={cerebro === o.id} onClick={() => trocar(o.id)}>{o.rotulo}</button>)}
        </div>
      </div>

      {cerebro === "claude" && <>
        <p>Abra o Claude Code na pasta Claude e mande o comando. Ele lê as transcrições, marca os momentos e já deixa a câmera do streamer posicionada.</p>
        <Copiar texto="/sk-cortes momentos" grande={grande} />
      </>}

      {cerebro === "codex" && <>
        <p>Abra o Codex na pasta <code>sk-cortes</code> e mande a frase abaixo. Ele segue as mesmas regras do Claude (arquivo AGENTS.md) e grava no mesmo painel.</p>
        <Copiar texto="marca os momentos" grande={grande} />
      </>}

      {cerebro === "manual" && <>
        <p>Escolha o vídeo, abra no editor e marque você mesmo o início, o fim, o gancho e o enquadramento.</p>
        <div className="escolha-lista">
          {videos.length === 0 && <span className="sutil">Carregando…</span>}
          {videos.map((v) => (
            <div key={v.id} className="escolha-video">
              <span className="linha-titulo">{v.titulo ?? v.url}</span>
              <span className="sutil">{v.autor && <span>@{v.autor}</span>}{v.duracao != null && <span>{tempo(v.duracao)}</span>}</span>
              <button className="btn btn-forte" onClick={() => cortar(v)}>Cortar na mão</button>
            </div>
          ))}
        </div>
      </>}
      {erro && <div className="alerta alerta-erro">{erro}</div>}
    </div>
  );
}
