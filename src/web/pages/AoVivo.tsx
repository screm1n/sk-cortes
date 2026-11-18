import { useEffect, useRef, useState } from "react";
import { api, tempo, type Fonte, type Live, type Marca } from "../lib/api.ts";

/*
 * Clipar live em andamento. O painel grava os ultimos minutos de cada live e
 * acende "momentos quentes" quando o chat explode ou o streamer grita. Um clique
 * junta o trecho e abre no editor, enquanto a transcricao roda por tras.
 */

const TIPO: Record<Marca["tipo"], string> = { chat: "Chat explodiu", grito: "Grito no áudio", manual: "Você marcou" };

function haQuanto(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `há ${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `há ${m} min` : `há ${Math.floor(m / 60)} h`;
}

/** Bipe curto pra avisar de momento quente sem precisar olhar a tela. */
function bipe() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.35);
  } catch { /* navegador sem audio */ }
}

export function AoVivo({ editar }: { editar: (momentoId: number) => void }) {
  const [lives, setLives] = useState<Live[]>([]);
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [url, setUrl] = useState("");
  const [buffer, setBuffer] = useState(20);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [som, setSom] = useState(() => { try { return localStorage.getItem("skc-som") !== "0"; } catch { return true; } });
  const vistas = useRef<Set<number> | null>(null);

  const carregar = async () => {
    try {
      const ls = await api.lives();
      // Bipe so pra marca automatica nova (a primeira leitura so registra o que ja existe).
      const ids = ls.flatMap((l) => l.marcas.filter((m) => m.tipo !== "manual").map((m) => m.id));
      if (vistas.current && som && ids.some((id) => !vistas.current!.has(id))) bipe();
      vistas.current = new Set(ids);
      setLives(ls);
    } catch { /* servidor reiniciando */ }
  };

  useEffect(() => {
    api.fontes().then(setFontes).catch(() => {});
    void carregar();
    const t = setInterval(carregar, 2000);
    return () => clearInterval(t);
  }, [som]);

  const acao = async (chave: string, f: () => Promise<unknown>) => {
    setErro(""); setOcupado(chave);
    try { await f(); await carregar(); } catch (e) { setErro((e as Error).message); }
    setOcupado(null);
  };

  const clipar = (l: Live, b: { marcaId?: number; ultimos?: number }, chave: string) =>
    acao(chave, async () => { const r = await api.cliparLive(l.id, b); editar(r.momentoId); });

  const gravar = (u: string, fonteId?: number) => acao("gravar", () => api.gravarLive({ url: u, fonteId, bufferMin: buffer }));

  const ativas = lives.filter((l) => l.status !== "parado");
  const paradas = lives.filter((l) => l.status === "parado");

  return (
    <section className="pagina">
      <header className="cabeca">
        <h1>Ao vivo</h1>
        <p>O painel grava os últimos minutos da live e acende um aviso quando o chat explode ou o streamer grita. Um clique junta o trecho e abre no editor, sem esperar a live acabar.</p>
      </header>

      <form className="cartao form-linha" onSubmit={(e) => { e.preventDefault(); void gravar(url).then(() => setUrl("")); }}>
        <label className="larga">Link do canal ao vivo (Twitch, Kick ou YouTube)
          <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.twitch.tv/alanzoka" />
        </label>
        <label>Guardar os últimos
          <select value={buffer} onChange={(e) => setBuffer(Number(e.target.value))}>
            <option value={10}>10 min</option><option value={20}>20 min</option>
            <option value={30}>30 min</option><option value={60}>60 min</option>
          </select>
        </label>
        <button className="btn btn-forte" disabled={ocupado === "gravar"}>{ocupado === "gravar" ? "Conectando…" : "Começar a gravar"}</button>
      </form>

      {fontes.length > 0 && (
        <div className="filtros">
          <span className="sutil">Seus streamers:</span>
          {fontes.map((f) => (
            <button key={f.id} className="chip" disabled={!!ativas.find((l) => l.url === f.url)} onClick={() => gravar(f.url, f.id)}>
              {ativas.find((l) => l.url === f.url) ? `● ${f.nome}` : `+ ${f.nome}`}
            </button>
          ))}
          <label className="check som"><input type="checkbox" checked={som} onChange={(e) => {
            setSom(e.target.checked);
            try { localStorage.setItem("skc-som", e.target.checked ? "1" : "0"); } catch { /* sem storage */ }
          }} /> Bipe em momento quente</label>
        </div>
      )}

      {erro && <div className="alerta alerta-erro">{erro}</div>}

      {ativas.length === 0 && (
        <div className="vazio">Nenhuma live sendo gravada. Cole o link do canal ou clique num streamer acima quando ele entrar ao vivo.</div>
      )}

      <div className="lives">
        {ativas.map((l) => {
          const novas = l.marcas.filter((m) => m.status !== "ignorada");
          return (
            <article key={l.id} className={`cartao live live-${l.status}`}>
              <div className="live-topo">
                <div>
                  <span className={`ponto ponto-${l.status}`} aria-hidden />
                  <b>{l.canal}</b> <span className="etiqueta">{l.plataforma}</span>
                  <div className="sutil">
                    <span>{l.status === "gravando" ? "gravando" : l.status === "conectando" ? "conectando…" : "fora do ar"}</span>
                    <span>{tempo(l.gravado)} no buffer (guarda {Math.round(l.bufferSeg / 60)} min)</span>
                    {l.chatAtivo && <span>{l.chatMsgs} msgs no chat</span>}
                    <span><a href={l.url} target="_blank" rel="noreferrer">abrir a live</a></span>
                  </div>
                </div>
                <div className="acoes">
                  <button className="btn" onClick={() => acao(`m${l.id}`, () => api.marcarAgora(l.id))} disabled={l.gravado < 5}>Marcar agora</button>
                  <button className="btn btn-fantasma" onClick={() => acao(`p${l.id}`, () => api.pararLive(l.id))}>Parar</button>
                  <button className="btn btn-fantasma" onClick={() => { if (confirm("Parar e apagar a gravação desta live? Os cortes já feitos continuam.")) void acao(`a${l.id}`, () => api.pararLive(l.id, true)); }}>Apagar</button>
                </div>
              </div>
              {l.erro && l.status !== "gravando" && <div className="sutil live-erro">{l.erro}</div>}

              <div className="clipar-agora">
                <span>Clipar o que acabou de rolar:</span>
                {[30, 60, 90].map((s) => (
                  <button key={s} className="btn btn-forte" disabled={l.gravado < 5 || !!ocupado} onClick={() => clipar(l, { ultimos: s }, `u${l.id}-${s}`)}>
                    {ocupado === `u${l.id}-${s}` ? "Juntando…" : `Últimos ${s} s`}
                  </button>
                ))}
              </div>

              <div className="rotulo-secao">Momentos quentes {l.chatAtivo ? "(chat e áudio)" : "(só áudio nessa plataforma)"}</div>
              {novas.length === 0 ? (
                <p className="sutil">Nada ainda. O detector precisa de 1 minuto de live pra saber o que é normal.</p>
              ) : (
                <div className="quentes">
                  {novas.map((m) => (
                    <div key={m.id} className={`quente quente-${m.tipo} ${m.status === "clipada" ? "quente-feita" : ""}`}>
                      <div className="quente-info">
                        <b>{TIPO[m.tipo]}</b>
                        <span className="sutil">{haQuanto(m.em)}{m.tipo !== "manual" && ` · ${m.forca}x o normal`}</span>
                        {m.tipo !== "manual" && <span className="quente-detalhe">{m.detalhe}</span>}
                      </div>
                      <div className="acoes">
                        {m.status === "clipada" && m.momentoId ? (
                          <button className="btn" onClick={() => editar(m.momentoId!)}>Abrir corte</button>
                        ) : (
                          <>
                            <button className="btn btn-forte" disabled={!!ocupado} onClick={() => clipar(l, { marcaId: m.id }, `k${m.id}`)}>
                              {ocupado === `k${m.id}` ? "Juntando…" : "Clipar e editar"}
                            </button>
                            <button className="btn btn-fantasma" onClick={() => acao(`i${m.id}`, () => api.ignorarMarca(l.id, m.id))}>Ignorar</button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {paradas.length > 0 && <p className="sutil dica">Paradas: {paradas.map((l) => l.canal).join(", ")}.</p>}
      <p className="sutil dica">O clip pega 30 s antes e 8 s depois do momento, com folga pra você ajustar no editor. A legenda aparece quando a transcrição terminar (barra da esquerda).</p>
    </section>
  );
}
