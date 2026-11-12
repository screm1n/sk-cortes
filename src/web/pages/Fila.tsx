import { useEffect, useState } from "react";
import { api, copiar, milhar, tempo, type Render } from "../lib/api.ts";

const TIPO: Record<string, string> = { curto: "corte", compilacao: "compilação", dica: "dica narrada" };

/** Horarios que costumam render pra game no Brasil. Ponto de partida, o caderno ajusta. */
const HORARIOS = ["12h", "18h30", "21h"];

export function Fila({ versao, aoMudar }: { versao: number; aoMudar: () => void }) {
  const [lista, setLista] = useState<Render[]>([]);
  const [mostrarPostados, setMostrarPostados] = useState(false);
  const [erro, setErro] = useState("");

  const carregar = () => api.renders().then(setLista).catch((e: Error) => setErro(e.message));
  useEffect(() => { void carregar(); }, [versao]);
  // Enquanto tem render andando, atualiza mais vezes pra o video aparecer sozinho.
  useEffect(() => {
    if (!lista.some((r) => r.status === "renderizando")) return;
    const t = setInterval(carregar, 3000);
    return () => clearInterval(t);
  }, [lista]);

  const editar = async (id: number, c: Partial<Render>) => {
    setErro("");
    try { await api.editarRender(id, c); await carregar(); aoMudar(); } catch (e) { setErro((e as Error).message); }
  };

  const visiveis = lista.filter((r) => (mostrarPostados ? r.status === "postado" : r.status !== "postado"));
  const postados = lista.filter((r) => r.status === "postado");
  const totalViews = postados.reduce((s, r) => s + (r.viewsReels ?? 0) + (r.viewsTiktok ?? 0), 0);

  return (
    <section className="pagina">
      <header className="cabeca">
        <h1>Fila de postagem</h1>
        <p>Baixe o vídeo, copie a legenda e poste no Reels e no TikTok. Depois cole o link e as views: o Claude usa isso pra aprender o que funciona.</p>
      </header>

      <div className="filtros">
        <button className="chip" aria-pressed={!mostrarPostados} onClick={() => setMostrarPostados(false)}>Pra postar</button>
        <button className="chip" aria-pressed={mostrarPostados} onClick={() => setMostrarPostados(true)}>Postados ({postados.length}{totalViews ? ` · ${milhar(totalViews)} views` : ""})</button>
        <span className="sutil horarios">horários sugeridos: {HORARIOS.join(" · ")}</span>
      </div>

      {erro && <div className="alerta alerta-erro">{erro}</div>}

      {visiveis.length === 0 ? (
        <div className="vazio">{mostrarPostados ? "Nada postado ainda." : "Fila vazia. Renderize um momento pra ele virar vídeo aqui."}</div>
      ) : (
        <div className="grade-fila">
          {visiveis.map((r) => <CartaoRender key={r.id} r={r} editar={editar} apagar={async () => {
            if (!confirm("Tirar esse vídeo da fila?")) return;
            await api.apagarRender(r.id); await carregar(); aoMudar();
          }} />)}
        </div>
      )}
    </section>
  );
}

function Copiavel({ rotulo, texto }: { rotulo: string; texto: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="copiavel">
      <div className="copiavel-topo">
        <span>{rotulo}</span>
        <button className="mini" onClick={() => { void copiar(texto); setOk(true); setTimeout(() => setOk(false), 1400); }}>{ok ? "copiado" : "copiar"}</button>
      </div>
      <p>{texto}</p>
    </div>
  );
}

function CartaoRender({ r, editar, apagar }: { r: Render; editar: (id: number, c: Partial<Render>) => void; apagar: () => void }) {
  const tags = r.hashtags ?? "";
  const reels = [r.legendaReels ?? r.gancho ?? "", tags].filter(Boolean).join("\n\n");
  const tiktok = [r.legendaTiktok ?? r.gancho ?? "", tags].filter(Boolean).join(" ");
  const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.round(Number(v.replace(/\D/g, "")))));

  return (
    <article className="cartao render">
      <div className="render-video">
        {r.status === "pronto" || r.status === "postado" ? (
          <video src={r.midia ?? undefined} controls preload="metadata" playsInline />
        ) : r.status === "erro" ? (
          <div className="render-estado render-erro">Falhou<small>{r.erro}</small></div>
        ) : (
          <div className="render-estado"><span className="girando" />renderizando</div>
        )}
      </div>
      <div className="render-corpo">
        <div className="momento-topo">
          <span className="etiqueta">{TIPO[r.tipo] ?? r.tipo}</span>
          {r.duracao != null && <span className={`sutil ${r.duracao >= 61 ? "ok" : ""}`}>{tempo(r.duracao)}{r.duracao >= 61 ? " · paga no TikTok" : ""}</span>}
        </div>
        <h3>{r.gancho}</h3>
        <Copiavel rotulo="Legenda Reels" texto={reels} />
        <Copiavel rotulo="Legenda TikTok" texto={tiktok} />

        {r.status === "postado" ? (
          <div className="metricas">
            <label>Link Reels<input defaultValue={r.linkReels ?? ""} onBlur={(e) => editar(r.id, { linkReels: e.target.value || null })} /></label>
            <label>Views Reels<input inputMode="numeric" defaultValue={r.viewsReels ?? ""} onBlur={(e) => editar(r.id, { viewsReels: num(e.target.value) })} /></label>
            <label>Link TikTok<input defaultValue={r.linkTiktok ?? ""} onBlur={(e) => editar(r.id, { linkTiktok: e.target.value || null })} /></label>
            <label>Views TikTok<input inputMode="numeric" defaultValue={r.viewsTiktok ?? ""} onBlur={(e) => editar(r.id, { viewsTiktok: num(e.target.value) })} /></label>
          </div>
        ) : null}

        <div className="acoes">
          {r.midia && (r.status === "pronto" || r.status === "postado") && (
            <a className="btn btn-forte" href={r.midia} download={`sk-cortes-${r.id}.mp4`}>Baixar mp4</a>
          )}
          {r.status === "pronto" && <button className="btn" onClick={() => editar(r.id, { status: "postado" })}>Marquei como postado</button>}
          {r.status === "postado" && <button className="btn btn-fantasma" onClick={() => editar(r.id, { status: "pronto" })}>Voltar pra fila</button>}
          {r.status !== "renderizando" && <button className="btn btn-fantasma" onClick={apagar}>Tirar</button>}
        </div>
      </div>
    </article>
  );
}
