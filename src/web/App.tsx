import { useCallback, useEffect, useState } from "react";
import { api, type Estado } from "./lib/api.ts";
import { Inicio } from "./pages/Inicio.tsx";
import { Fontes } from "./pages/Fontes.tsx";
import { Radar } from "./pages/Radar.tsx";
import { Momentos } from "./pages/Momentos.tsx";
import { Fila } from "./pages/Fila.tsx";
import { Caderno } from "./pages/Caderno.tsx";
import { Ideias } from "./pages/Ideias.tsx";
import { Ajustes } from "./pages/Ajustes.tsx";

type Aba = "inicio" | "fontes" | "radar" | "momentos" | "fila" | "caderno" | "ideias" | "ajustes";

interface Item { id: Aba; rotulo: string; passo?: number; conta?: (e: Estado) => number }

// A ordem do menu e a ordem do trabalho: de onde vem o video ate ele ser postado.
const GRUPOS: { titulo: string | null; itens: Item[] }[] = [
  { titulo: null, itens: [{ id: "inicio", rotulo: "Início" }] },
  {
    titulo: "Produção",
    itens: [
      { id: "fontes", rotulo: "Streamers", passo: 1 },
      { id: "radar", rotulo: "Radar", passo: 2, conta: (e) => e.contagens.novos + e.contagens.aguardandoClaude },
      { id: "momentos", rotulo: "Momentos", passo: 3, conta: (e) => e.contagens.momentos },
      { id: "fila", rotulo: "Fila de postagem", passo: 4, conta: (e) => e.contagens.prontos },
    ],
  },
  {
    titulo: "Estratégia",
    itens: [
      { id: "caderno", rotulo: "Caderno" },
      { id: "ideias", rotulo: "Ideias de dinheiro" },
      { id: "ajustes", rotulo: "Ajustes" },
    ],
  },
];

const TODAS = GRUPOS.flatMap((g) => g.itens.map((i) => i.id));

function abaInicial(): Aba {
  const h = location.hash.slice(1) as Aba;
  return TODAS.includes(h) ? h : "inicio";
}

export function App() {
  const [aba, setAba] = useState<Aba>(abaInicial);
  const [estado, setEstado] = useState<Estado | null>(null);
  // Muda quando um job termina: as paginas recarregam a lista sozinhas.
  const [versao, setVersao] = useState(0);
  // Corte criado em outra tela (ex.: "Cortar na mao" no Radar) que deve abrir direto no editor.
  const [abrirMomento, setAbrirMomento] = useState<number | null>(null);

  const ir = useCallback((a: Aba) => { setAba(a); history.replaceState(null, "", `#${a}`); }, []);

  const atualizar = useCallback(async () => {
    try {
      const e = await api.estado();
      setEstado((antes) => {
        const ativos = (x: Estado) => x.jobs.filter((j) => j.status === "rodando" || j.status === "fila").length;
        if (antes && (ativos(e) < ativos(antes) || e.contagens.momentos !== antes.contagens.momentos)) setVersao((v) => v + 1);
        return e;
      });
    } catch { /* servidor reiniciando */ }
  }, []);

  useEffect(() => {
    void atualizar();
    const t = setInterval(atualizar, 2000);
    return () => clearInterval(t);
  }, [atualizar]);

  const editar = useCallback((id: number) => { setAbrirMomento(id); ir("momentos"); }, [ir]);

  const ativo = estado?.jobs.find((j) => j.status === "rodando");
  const naFila = estado?.jobs.filter((j) => j.status === "fila").length ?? 0;
  const ultimoErro = estado?.jobs[0]?.status === "erro" ? estado.jobs[0] : undefined;
  const marca = estado?.ajustes.handle ?? null;

  return (
    <div className="app">
      <nav className="rail" aria-label="Menu">
        <div className="marca">
          <span className="marca-nome">SK CORTES</span>
          <span className="marca-sub">fábrica GTA 6</span>
        </div>
        {GRUPOS.map((g, k) => (
          <div key={k} className="rail-grupo">
            {g.titulo && <div className="rail-titulo">{g.titulo}</div>}
            {g.itens.map((a) => {
              const n = estado && a.conta ? a.conta(estado) : 0;
              return (
                <button key={a.id} className="rail-item" aria-current={aba === a.id ? "page" : undefined} onClick={() => ir(a.id)}>
                  {a.passo && <span className="rail-passo">{a.passo}</span>}
                  <span className="rail-rotulo">{a.rotulo}</span>
                  {n > 0 && <span className="rail-conta">{n}</span>}
                </button>
              );
            })}
          </div>
        ))}
        <div className="rail-rodape">
          {ativo ? (
            <div className="job">
              <div className="job-titulo">{ativo.titulo}</div>
              <div className="barra"><i style={{ width: `${ativo.progresso.total ? (ativo.progresso.atual / ativo.progresso.total) * 100 : 5}%` }} /></div>
              <div className="job-msg">{ativo.progresso.mensagem}{naFila > 0 && ` · +${naFila} na fila`}</div>
            </div>
          ) : ultimoErro ? (
            <div className="job job-erro" title={ultimoErro.erro ?? ""}>
              <div className="job-titulo">Falhou: {ultimoErro.titulo}</div>
              <div className="job-msg">{ultimoErro.erro?.slice(0, 140)}</div>
            </div>
          ) : (
            <div className="job job-parado">nada rodando</div>
          )}
          <button className="perfil" onClick={() => ir("ajustes")} title="Trocar o @ do perfil">{marca === "@seuperfil" ? "definir o @ do perfil" : marca}</button>
        </div>
      </nav>

      <main className="conteudo">
        {aba === "inicio" && <Inicio estado={estado} ir={ir} aoMudar={atualizar} editar={editar} />}
        {aba === "radar" && <Radar versao={versao} estado={estado} aoMudar={atualizar} editar={editar} />}
        {aba === "momentos" && <Momentos versao={versao} marca={marca} aoMudar={atualizar} irFila={() => ir("fila")} abrir={abrirMomento} aoAbrir={() => setAbrirMomento(null)} />}
        {aba === "fila" && <Fila versao={versao} aoMudar={atualizar} />}
        {aba === "fontes" && <Fontes aoMudar={atualizar} irRadar={() => ir("radar")} />}
        {aba === "caderno" && <Caderno versao={versao} aoMudar={atualizar} />}
        {aba === "ideias" && <Ideias />}
        {aba === "ajustes" && <Ajustes estado={estado} aoMudar={atualizar} />}
      </main>
    </div>
  );
}
