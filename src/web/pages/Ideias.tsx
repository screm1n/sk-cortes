import { useEffect, useState } from "react";
import { api, type Ideia } from "../lib/api.ts";

const COLUNAS = [
  { id: "rodando", rotulo: "Rodando" },
  { id: "testando", rotulo: "Testando" },
  { id: "ideia", rotulo: "Ideias" },
  { id: "descartada", rotulo: "Descartadas" },
];

export function Ideias() {
  const [ideias, setIdeias] = useState<Ideia[]>([]);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState("");

  useEffect(() => { api.ideias().then(setIdeias).catch((e: Error) => setErro(e.message)); }, []);

  const criar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    try { setIdeias(await api.criarIdeia({ titulo, descricao })); setTitulo(""); setDescricao(""); }
    catch (e) { setErro((e as Error).message); }
  };

  return (
    <section className="pagina">
      <header className="cabeca">
        <h1>Ideias de dinheiro</h1>
        <p>Tudo que pode virar caixa com o hype do GTA 6. O caderno também joga ideia aqui quando um vídeo estudado traz algo novo.</p>
      </header>

      <form className="cartao form-linha" onSubmit={criar}>
        <label>Ideia<input required minLength={3} value={titulo} onChange={(e) => setTitulo(e.target.value)} /></label>
        <label className="larga">Como funciona<input value={descricao} onChange={(e) => setDescricao(e.target.value)} /></label>
        <button className="btn btn-forte" type="submit">Anotar</button>
      </form>
      {erro && <div className="alerta alerta-erro">{erro}</div>}

      <div className="colunas">
        {COLUNAS.map((c) => {
          const itens = ideias.filter((i) => i.status === c.id);
          return (
            <div key={c.id} className="coluna">
              <h2>{c.rotulo} <span className="sutil">{itens.length}</span></h2>
              {itens.map((i) => (
                <div key={i.id} className="cartao ideia">
                  <b>{i.titulo}</b>
                  {i.descricao && <p>{i.descricao}</p>}
                  <div className="ideia-rodape">
                    <span className="sutil">{i.origem}</span>
                    <select value={i.status} aria-label="Status" onChange={async (e) => setIdeias(await api.editarIdeia(i.id, { status: e.target.value }))}>
                      {COLUNAS.map((x) => <option key={x.id} value={x.id}>{x.rotulo}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
