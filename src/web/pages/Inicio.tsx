import { useState } from "react";
import { api, type Estado } from "../lib/api.ts";
import { Escolha, NOME_CEREBRO, type Cerebro } from "./Escolha.tsx";

type Aba = "inicio" | "fontes" | "aovivo" | "radar" | "momentos" | "fila" | "caderno" | "ideias" | "ajustes";

interface Passo { n: number; aba: Aba; nome: string; faz: string; quem: "voce" | "painel" | "claude" | "codex"; conta: number; rotulo: string }

/**
 * A tela inicial responde uma pergunta so: "o que eu faco agora?". Mostra a esteira
 * inteira e destaca o passo que esta travando o proximo video.
 */
export function Inicio({ estado, ir, aoMudar, editar }: { estado: Estado | null; ir: (a: Aba) => void; aoMudar: () => void; editar: (momentoId: number) => void }) {
  const [url, setUrl] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  if (!estado) return <section className="pagina"><div className="vazio">Carregando…</div></section>;
  const c = estado.contagens;
  const cerebro = (estado.ajustes.cerebro ?? "claude") as Cerebro;
  const quemEscolhe = cerebro === "manual" ? "voce" : cerebro;

  const passos: Passo[] = [
    { n: 1, aba: "radar", nome: "Achar", faz: "Cole um link ou busque os clips dos streamers", quem: "voce", conta: c.novos, rotulo: "novos" },
    { n: 2, aba: "radar", nome: "Baixar", faz: "O painel baixa e transcreve sozinho", quem: "painel", conta: c.andando, rotulo: "andando" },
    { n: 3, aba: "radar", nome: "Escolher", faz: cerebro === "manual" ? "Você marca os momentos no editor" : `O ${NOME_CEREBRO[cerebro]} marca os momentos virais`, quem: quemEscolhe, conta: c.aguardandoClaude, rotulo: "esperando" },
    { n: 4, aba: "momentos", nome: "Editar", faz: "Você ajusta o corte e o enquadramento", quem: "voce", conta: c.momentos, rotulo: "pra revisar" },
    { n: 5, aba: "fila", nome: "Postar", faz: "Baixa o mp4, copia a legenda e posta", quem: "voce", conta: c.prontos, rotulo: "prontos" },
  ];

  // O passo mais perto de virar video postado e o que manda.
  const proximo =
    c.prontos > 0 ? 5 : c.momentos > 0 ? 4 : c.aguardandoClaude > 0 ? 3 : c.andando > 0 ? 2 : 1;

  const colar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErro(""); setAviso("");
    try {
      await api.adicionarVideo({ url, tipo: "corte" });
      setUrl("");
      setAviso("Baixando e transcrevendo. Acompanhe na barra da esquerda.");
      aoMudar();
    } catch (e) { setErro((e as Error).message); }
  };

  const acaoPrincipal = () => {
    if (proximo === 5) return (
      <><h2>{c.prontos} {c.prontos === 1 ? "vídeo pronto" : "vídeos prontos"} pra postar</h2>
        <p>Baixe o mp4, copie a legenda e poste no Reels e no TikTok.</p>
        <button className="btn btn-forte btn-grande" onClick={() => ir("fila")}>Abrir a fila</button></>
    );
    if (proximo === 4) return (
      <><h2>{c.momentos} {c.momentos === 1 ? "momento esperando" : "momentos esperando"} sua revisão</h2>
        <p>Abra no editor, escolha o modelo (tela dividida, desfocado ou tela cheia) e mande renderizar.</p>
        <button className="btn btn-forte btn-grande" onClick={() => ir("momentos")}>Revisar momentos</button></>
    );
    if (proximo === 3) return <Escolha estado={estado} aoMudar={aoMudar} editar={editar} grande />;
    if (proximo === 2) return (
      <><h2>Baixando e transcrevendo</h2>
        <p>{c.andando} {c.andando === 1 ? "vídeo" : "vídeos"} na esteira. A transcrição leva mais ou menos 1 minuto por minuto de vídeo.</p></>
    );
    return (
      <><h2>{c.novos > 0 ? `${c.novos} clips novos esperando download` : "Comece colando um link"}</h2>
        <p>{c.novos > 0 ? "Baixe todos de uma vez ou escolha no Radar." : "Clip da Twitch, vídeo do YouTube, Short, Kick ou TikTok. O painel baixa e transcreve."}</p>
        {c.novos > 0 && (
          <div className="acoes">
            <button className="btn btn-forte btn-grande" onClick={async () => { await api.baixarNovos(); setAviso("Tudo na esteira."); aoMudar(); }}>Baixar os {c.novos}</button>
            <button className="btn btn-grande" onClick={() => ir("radar")}>Escolher no Radar</button>
          </div>
        )}</>
    );
  };

  return (
    <section className="pagina">
      <header className="cabeca">
        <h1>O que fazer agora</h1>
        <p>A esteira vai da esquerda pra direita. O passo aceso é o que está segurando o próximo vídeo.</p>
      </header>

      <ol className="esteira">
        {passos.map((p) => (
          <li key={p.n} className={`estacao ${p.n === proximo ? "estacao-agora" : ""} ${p.conta > 0 ? "estacao-cheia" : ""}`}>
            <button onClick={() => ir(p.aba)}>
              <span className="estacao-n">{p.n}</span>
              <strong>{p.nome}</strong>
              <span className="estacao-faz">{p.faz}</span>
              <span className="estacao-conta"><b>{p.conta}</b> {p.rotulo}</span>
              <span className={`estacao-quem quem-${p.quem}`}>{p.quem === "voce" ? "você" : p.quem === "claude" ? "Claude" : p.quem === "codex" ? "Codex" : "automático"}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="agora">{acaoPrincipal()}</div>

      <form className="cartao form-linha" onSubmit={colar}>
        <label className="larga">Colar um link novo
          <input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.twitch.tv/streamer/clip/..." />
        </label>
        <button className="btn btn-forte" type="submit">Baixar e transcrever</button>
        <button className="btn" type="button" onClick={() => ir("fontes")}>{c.fontes > 0 ? `Meus streamers (${c.fontes})` : "Cadastrar streamers"}</button>
      </form>
      {erro && <div className="alerta alerta-erro">{erro}</div>}
      {aviso && <div className="alerta">{aviso}</div>}

      <div className="resumo">
        <div><b>{c.postados}</b><span>vídeos postados</span></div>
        <div><b>{c.fontes}</b><span>streamers</span></div>
        <div><b>{c.estudos}</b><span>vídeos estudados no Caderno</span></div>
      </div>
    </section>
  );
}
