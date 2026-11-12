import { useEffect, useState } from "react";
import { api, milhar, tempo, type Estado, type Video } from "../lib/api.ts";
import { Escolha } from "./Escolha.tsx";

const FILTROS: { id: string; rotulo: string; status: string }[] = [
  { id: "todos", rotulo: "Todos", status: "" },
  { id: "novos", rotulo: "Novos", status: "novo" },
  { id: "andando", rotulo: "Baixando", status: "baixando,baixado,transcrevendo" },
  { id: "claude", rotulo: "Esperando os momentos", status: "transcrito" },
  { id: "feitos", rotulo: "Analisados", status: "analisado" },
  { id: "erro", rotulo: "Com erro", status: "erro" },
];

const ROTULO_STATUS: Record<string, string> = {
  novo: "novo", baixando: "baixando", baixado: "baixado", transcrevendo: "transcrevendo",
  transcrito: "esperando os momentos", analisado: "analisado", descartado: "descartado", erro: "erro",
};

export function Radar({ versao, estado, aoMudar, editar }: { versao: number; estado: Estado | null; aoMudar: () => void; editar: (momentoId: number) => void }) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [filtro, setFiltro] = useState("todos");
  const [url, setUrl] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [trecho, setTrecho] = useState(false);
  const [erro, setErro] = useState("");

  const status = FILTROS.find((f) => f.id === filtro)!.status;
  const carregar = () => api.videos("corte", status).then(setVideos).catch((e: Error) => setErro(e.message));
  useEffect(() => { void carregar(); }, [filtro, versao]);

  const adicionar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErro("");
    try {
      await api.adicionarVideo({ url, tipo: "corte", ...(trecho && de && ate ? { de, ate } : {}) });
      setUrl(""); setDe(""); setAte("");
      await carregar(); aoMudar();
    } catch (e) { setErro((e as Error).message); }
  };

  const acao = async (f: () => Promise<unknown>) => {
    setErro("");
    try { await f(); await carregar(); aoMudar(); } catch (e) { setErro((e as Error).message); }
  };

  const esperando = estado?.contagens.aguardandoClaude ?? 0;

  return (
    <section className="pagina">
      <header className="cabeca">
        <h1>Radar</h1>
        <p>Tudo que entra aqui é baixado e transcrito. Depois os momentos são escolhidos: pelo Claude, pelo Codex ou por você, na mão.</p>
      </header>

      {esperando > 0 && <Escolha estado={estado} aoMudar={aoMudar} editar={editar} />}

      <form className="cartao form-linha" onSubmit={adicionar}>
        <label className="larga">Colar link (clip, vídeo, VOD, Short)
          <input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://clips.twitch.tv/..." />
        </label>
        <label className="check"><input type="checkbox" checked={trecho} onChange={(e) => setTrecho(e.target.checked)} /> só um trecho</label>
        {trecho && <>
          <label>De<input value={de} onChange={(e) => setDe(e.target.value)} placeholder="1:02:00" /></label>
          <label>Até<input value={ate} onChange={(e) => setAte(e.target.value)} placeholder="1:20:00" /></label>
        </>}
        <button className="btn btn-forte" type="submit">Baixar e transcrever</button>
      </form>
      {trecho && <p className="sutil dica">Pra live longa: baixa só o pedaço que interessa. A transcrição no PC leva mais ou menos 1 minuto por minuto de vídeo.</p>}

      {erro && <div className="alerta alerta-erro">{erro}</div>}

      <div className="filtros">
        {FILTROS.map((f) => (
          <button key={f.id} className="chip" aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>{f.rotulo}</button>
        ))}
        {(estado?.contagens.novos ?? 0) > 0 && (
          <button className="btn btn-forte baixar-todos" onClick={() => acao(() => api.baixarNovos())}>Baixar os {estado!.contagens.novos} novos</button>
        )}
      </div>

      {videos.length === 0 ? (
        <div className="vazio">Nada aqui. Cole um link acima ou use "Buscar clips" num streamer.</div>
      ) : (
        <div className="tabela">
          {videos.map((v) => (
            <div key={v.id} className="linha">
              <div className="linha-principal">
                <a href={v.url} target="_blank" rel="noreferrer" className="linha-titulo">{v.titulo ?? v.url}</a>
                <div className="sutil">
                  {v.autor && <span>{v.autor}</span>}
                  {v.duracao != null && <span>{tempo(v.duracao)}</span>}
                  {v.views != null && <span>{milhar(v.views)} views</span>}
                  {v.idioma && <span>{v.idioma}</span>}
                </div>
                {v.erro && <div className="linha-erro">{v.erro}</div>}
              </div>
              <span className={`pilula pilula-${v.status}`}>{ROTULO_STATUS[v.status] ?? v.status}</span>
              <div className="acoes">
                {["novo", "erro", "descartado"].includes(v.status) && <button className="btn btn-forte" onClick={() => acao(() => api.baixar(v.id))}>Baixar</button>}
                {["transcrito", "analisado", "erro"].includes(v.status) && v.midia && <button className="btn" onClick={() => acao(() => api.transcrever(v.id))}>Transcrever de novo</button>}
                {v.midia && ["baixado", "transcrevendo", "transcrito", "analisado"].includes(v.status) && (
                  <button className="btn" onClick={() => acao(async () => editar((await api.corteManual(v.id)).id))}>Cortar na mão</button>
                )}
                {v.status !== "descartado" && <button className="btn btn-fantasma" onClick={() => acao(() => api.descartar(v.id))}>Descartar</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
