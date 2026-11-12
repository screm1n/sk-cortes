import { useEffect, useState } from "react";
import { api, NOME_LAYOUT, type Momento } from "../lib/api.ts";
import { Editor } from "./Editor.tsx";

const FILTROS = [
  { id: "sugerido", rotulo: "Para revisar" },
  { id: "aprovado", rotulo: "Aprovados" },
  { id: "renderizado", rotulo: "Já renderizados" },
  { id: "descartado", rotulo: "Descartados" },
];

export function Momentos({ versao, marca, aoMudar, irFila, abrir, aoAbrir }: {
  versao: number; marca: string | null; aoMudar: () => void; irFila: () => void;
  abrir?: number | null; aoAbrir?: () => void;
}) {
  const [lista, setLista] = useState<Momento[]>([]);
  const [filtro, setFiltro] = useState("sugerido");
  const [selecionados, setSelecionados] = useState<number[]>([]);
  const [ganchoComp, setGanchoComp] = useState("Os momentos mais insanos do GTA 6 hoje");
  const [editando, setEditando] = useState<Momento | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const carregar = () => api.momentos(filtro).then(setLista).catch((e: Error) => setErro(e.message));
  useEffect(() => { void carregar(); }, [filtro, versao]);

  // Veio de "Cortar na mao": abre esse corte direto no editor.
  useEffect(() => {
    if (!abrir) return;
    api.momentos().then((todos) => {
      const m = todos.find((x) => x.id === abrir);
      if (m) setEditando(m);
      aoAbrir?.();
    }).catch(() => aoAbrir?.());
  }, [abrir]);

  const acao = async (f: () => Promise<unknown>, msg?: string) => {
    setErro(""); setAviso("");
    try { await f(); if (msg) setAviso(msg); await carregar(); aoMudar(); } catch (e) { setErro((e as Error).message); }
  };

  const duracaoSel = selecionados.reduce((s, id) => {
    const m = lista.find((x) => x.id === id);
    return s + (m ? m.fim - m.inicio : 0);
  }, 0);
  const alternar = (id: number) => setSelecionados((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  if (editando) {
    return (
      <Editor momento={editando} marca={marca} aoFechar={() => setEditando(null)}
        aoSalvar={(msg) => { setEditando(null); setAviso(msg); void carregar(); aoMudar(); }} />
    );
  }

  return (
    <section className="pagina">
      <header className="cabeca">
        <h1>Momentos</h1>
        <p>O que o Claude marcou nos vídeos. Abra no editor pra ajustar o corte e o enquadramento, depois renderize. Marque vários pra montar uma compilação de mais de 1 minuto (o TikTok só paga por view acima de 1 min).</p>
      </header>

      <div className="filtros">
        {FILTROS.map((f) => (
          <button key={f.id} className="chip" aria-pressed={filtro === f.id} onClick={() => { setFiltro(f.id); setSelecionados([]); }}>{f.rotulo}</button>
        ))}
      </div>

      {erro && <div className="alerta alerta-erro">{erro}</div>}
      {aviso && <div className="alerta" role="button" onClick={irFila}>{aviso} <u>Abrir a Fila</u></div>}

      {lista.length === 0 ? (
        <div className="vazio">
          {filtro === "sugerido" ? "Nenhum momento pra revisar. Quando o Radar tiver vídeos esperando, escolha os momentos pelo Claude, pelo Codex ou corte na mão." : "Nada aqui."}
        </div>
      ) : (
        <div className="grade-momentos">
          {lista.map((m) => {
            const dur = m.fim - m.inicio;
            const marcado = selecionados.includes(m.id);
            return (
              <article key={m.id} className={`cartao momento ${marcado ? "momento-marcado" : ""}`}>
                <button className="momento-capa" onClick={() => setEditando(m)} aria-label={`Editar: ${m.gancho}`}>
                  {m.midia && <video src={`${m.midia}#t=${m.inicio + Math.min(2, dur / 2)}`} preload="metadata" muted playsInline tabIndex={-1} />}
                  <span className="nota" title="Chance de viralizar, na opinião do Claude">{m.nota}/10</span>
                  <span className="capa-dur">{dur.toFixed(0)} s</span>
                  <span className="capa-editar">Abrir no editor</span>
                </button>
                <div className="momento-corpo">
                  <h3>{m.gancho}</h3>
                  <div className="sutil">
                    {m.video.autor && <span>@{m.video.autor}</span>}
                    <span>{NOME_LAYOUT[m.layout]}</span>
                    {m.legendas && <span>legenda editada</span>}
                  </div>
                  {m.porque && <p className="porque">{m.porque}</p>}
                  <div className="acoes">
                    <button className="btn btn-forte" onClick={() => setEditando(m)}>Editar</button>
                    <button className="btn" onClick={() => acao(async () => { await api.editarMomento(m.id, { status: "aprovado" }); await api.renderCurto(m.id); },
                      "Foi pra fábrica do jeito que está. O vídeo aparece na Fila em alguns segundos.")}>
                      {m.status === "renderizado" ? "Renderizar de novo" : "Renderizar assim"}
                    </button>
                    {m.status !== "descartado" && <button className="btn btn-fantasma" onClick={() => acao(() => api.editarMomento(m.id, { status: "descartado" }))}>Descartar</button>}
                    <label className="check"><input type="checkbox" checked={marcado} onChange={() => alternar(m.id)} /> compilação</label>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selecionados.length > 0 && (
        <div className="barra-comp">
          <div>
            <b>{selecionados.length} na compilação</b>
            <span className={duracaoSel >= 61 ? "ok" : "falta"}> · {Math.round(duracaoSel)} s {duracaoSel >= 61 ? "(passa de 1 min)" : `(faltam ${Math.ceil(61 - duracaoSel)} s pra 1 min)`}</span>
          </div>
          <input value={ganchoComp} onChange={(e) => setGanchoComp(e.target.value)} aria-label="Gancho da compilação" />
          <button className="btn btn-forte" disabled={selecionados.length < 2} onClick={() =>
            acao(async () => { await api.renderCompilacao({ momentoIds: selecionados, gancho: ganchoComp }); setSelecionados([]); },
              "Compilação na fábrica. O melhor momento fecha o vídeo como #1.")}>Montar compilação</button>
        </div>
      )}
    </section>
  );
}
