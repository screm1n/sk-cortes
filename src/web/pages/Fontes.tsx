import { useEffect, useState } from "react";
import { api, type Fonte } from "../lib/api.ts";

type Nova = { nome: string; url: string; idioma: string; origem: "br" | "gringo"; libera: "sim" | "nao" | "?" };
const VAZIA: Nova = { nome: "", url: "", idioma: "pt", origem: "br", libera: "?" };

export function Fontes({ aoMudar, irRadar }: { aoMudar: () => void; irRadar: () => void }) {
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [nova, setNova] = useState<Nova>(VAZIA);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const carregar = () => api.fontes().then(setFontes).catch((e: Error) => setErro(e.message));
  useEffect(() => { void carregar(); }, []);

  const criar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErro("");
    try {
      await api.criarFonte(nova);
      setNova(VAZIA);
      await carregar();
      aoMudar();
    } catch (e) { setErro((e as Error).message); }
  };

  const editar = async (id: number, campos: Partial<Fonte>) => {
    try { await api.editarFonte(id, campos); await carregar(); } catch (e) { setErro((e as Error).message); }
  };

  const buscar = async (f: Fonte) => {
    setErro("");
    try {
      await api.buscarFonte(f.id);
      setAviso(`Buscando os clips novos de ${f.nome}. Eles aparecem no Radar como "novo".`);
      aoMudar();
    } catch (e) { setErro((e as Error).message); }
  };

  return (
    <section className="pagina">
      <header className="cabeca">
        <h1>Streamers</h1>
        <p>De quem saem os cortes. Na Twitch, "Buscar clips" traz os mais vistos da semana: o público já escolheu o momento viral pra você.</p>
      </header>

      <form className="cartao form-linha" onSubmit={criar}>
        <label>Nome<input required value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} placeholder="gaules" /></label>
        <label className="larga">Link do canal<input required type="url" value={nova.url} onChange={(e) => setNova({ ...nova, url: e.target.value })} placeholder="https://www.twitch.tv/gaules" /></label>
        <label>Idioma
          <select value={nova.idioma} onChange={(e) => setNova({ ...nova, idioma: e.target.value, origem: e.target.value === "pt" ? "br" : "gringo" })}>
            <option value="pt">português</option><option value="en">inglês</option><option value="es">espanhol</option>
          </select>
        </label>
        <label>Libera cortes?
          <select value={nova.libera} onChange={(e) => setNova({ ...nova, libera: e.target.value as Nova["libera"] })}>
            <option value="?">não sei</option><option value="sim">sim</option><option value="nao">não</option>
          </select>
        </label>
        <button className="btn btn-forte" type="submit">Adicionar</button>
      </form>

      {erro && <div className="alerta alerta-erro">{erro}</div>}
      {aviso && <div className="alerta" onClick={irRadar} role="button">{aviso} <u>Abrir o Radar</u></div>}

      {fontes.length === 0 ? (
        <div className="vazio">Nenhum streamer ainda. Comece pelos que vão jogar GTA 6 no dia 19.</div>
      ) : (
        <div className="lista">
          {fontes.map((f) => (
            <div key={f.id} className="cartao fonte">
              <div className="fonte-topo">
                <div>
                  <b>{f.nome}</b> <span className="etiqueta">{f.plataforma}</span>
                  {f.libera === "nao" && <span className="etiqueta etiqueta-ruim">não libera</span>}
                  {f.libera === "sim" && <span className="etiqueta etiqueta-boa">libera cortes</span>}
                  <div className="sutil"><a href={f.url} target="_blank" rel="noreferrer">{f.url}</a></div>
                </div>
                <div className="acoes">
                  <button className="btn btn-forte" onClick={() => buscar(f)} disabled={f.libera === "nao"}>Buscar clips</button>
                  <button className="btn btn-fantasma" onClick={async () => {
                    if (!confirm(`Tirar ${f.nome} da lista? Os vídeos já baixados continuam.`)) return;
                    await api.apagarFonte(f.id); await carregar(); aoMudar();
                  }}>Tirar</button>
                </div>
              </div>
              <div className="fonte-opcoes">
                <label>Idioma
                  <select value={f.idioma} onChange={(e) => editar(f.id, { idioma: e.target.value, origem: e.target.value === "pt" ? "br" : "gringo" })}>
                    <option value="pt">português</option><option value="en">inglês</option><option value="es">espanhol</option>
                  </select>
                </label>
                <label>Libera cortes?
                  <select value={f.libera} onChange={(e) => editar(f.id, { libera: e.target.value as Fonte["libera"] })}>
                    <option value="?">não sei</option><option value="sim">sim</option><option value="nao">não</option>
                  </select>
                </label>
                <label className="larga">Notas<input defaultValue={f.notas ?? ""} onBlur={(e) => e.target.value !== (f.notas ?? "") && editar(f.id, { notas: e.target.value })} placeholder="ex.: só clipa GTA RP, horário das lives" /></label>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="sutil dica">A câmera de cada streamer você marca uma vez no editor do corte, e ela fica guardada pros próximos.</p>
    </section>
  );
}
