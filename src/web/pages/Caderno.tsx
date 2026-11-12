import { useEffect, useState } from "react";
import { api, copiar, type Estudo } from "../lib/api.ts";

const ROTULO: Record<string, string> = {
  novo: "na fila", baixando: "baixando", baixado: "baixado", transcrevendo: "transcrevendo",
  transcrito: "esperando o Claude", analisado: "analisado", erro: "erro",
};

export function Caderno({ versao, aoMudar }: { versao: number; aoMudar: () => void }) {
  const [regras, setRegras] = useState("");
  const [original, setOriginal] = useState("");
  const [estudos, setEstudos] = useState<Estudo[]>([]);
  const [url, setUrl] = useState("");
  const [aberto, setAberto] = useState<number | null>(null);
  const [erro, setErro] = useState("");
  const [salvo, setSalvo] = useState(false);

  const carregar = () => api.caderno().then((c) => {
    setEstudos(c.estudos);
    setOriginal(c.regras);
    setRegras((atual) => (atual === "" || atual === original ? c.regras : atual));
  }).catch((e: Error) => setErro(e.message));
  useEffect(() => { void carregar(); }, [versao]);

  const adicionar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErro("");
    try { await api.adicionarVideo({ url, tipo: "estudo" }); setUrl(""); await carregar(); aoMudar(); }
    catch (e) { setErro((e as Error).message); }
  };

  const pendentes = estudos.filter((e) => e.status === "transcrito").length;

  return (
    <section className="pagina">
      <header className="cabeca">
        <h1>Caderno de estratégia</h1>
        <p>Achou um vídeo de alguém explicando como vai ganhar dinheiro com GTA 6? Cola aqui. O painel transcreve, o Claude tira as táticas e propõe mudanças nas regras. As regras guiam todo corte, gancho e roteiro.</p>
      </header>

      <form className="cartao form-linha" onSubmit={adicionar}>
        <label className="larga">Link do vídeo de estudo (YouTube, TikTok, Reels)
          <input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
        </label>
        <button className="btn btn-forte" type="submit">Estudar esse vídeo</button>
      </form>

      {pendentes > 0 && (
        <div className="chamada">
          <div><b>{pendentes} {pendentes === 1 ? "vídeo pronto" : "vídeos prontos"} pra análise.</b> <span>No Claude Code:</span></div>
          <button className="comando" onClick={() => copiar("/sk-cortes aprender")}>/sk-cortes aprender <small>copiar</small></button>
        </div>
      )}

      {erro && <div className="alerta alerta-erro">{erro}</div>}

      <div className="caderno">
        <div className="caderno-estudos">
          <h2>Estudos ({estudos.length})</h2>
          {estudos.length === 0 && <div className="vazio">Nenhum vídeo estudado ainda.</div>}
          {estudos.map((e) => (
            <div key={e.id} className="cartao estudo">
              <button className="estudo-topo" onClick={() => setAberto(aberto === e.id ? null : e.id)} aria-expanded={aberto === e.id}>
                <span className="linha-titulo">{e.titulo ?? e.url}</span>
                <span className={`pilula pilula-${e.status}`}>{ROTULO[e.status] ?? e.status}</span>
              </button>
              {e.autor && <div className="sutil">{e.autor} · <a href={e.url} target="_blank" rel="noreferrer">abrir</a></div>}
              {e.erro && <div className="linha-erro">{e.erro}</div>}
              {aberto === e.id && e.analise && <pre className="analise">{e.analise}</pre>}
            </div>
          ))}
        </div>

        <div className="caderno-regras">
          <div className="regras-topo">
            <h2>Regras em vigor</h2>
            <button className="btn btn-forte" disabled={regras === original} onClick={async () => {
              await api.salvarRegras(regras); setOriginal(regras); setSalvo(true); setTimeout(() => setSalvo(false), 1500);
            }}>{salvo ? "Salvo" : "Salvar"}</button>
          </div>
          <textarea className="regras" value={regras} onChange={(e) => setRegras(e.target.value)} spellCheck={false} aria-label="Regras" />
          <p className="sutil">Arquivo: sk-cortes/estrategia/REGRAS.md. Pode editar aqui ou pedir pro Claude.</p>
        </div>
      </div>
    </section>
  );
}
