import { useEffect, useState } from "react";
import { api, type Estado } from "../lib/api.ts";

const VOZES = [
  { id: "pt-BR-AntonioNeural", rotulo: "Antônio (masculina)" },
  { id: "pt-BR-FranciscaNeural", rotulo: "Francisca (feminina)" },
  { id: "pt-BR-ThalitaMultilingualNeural", rotulo: "Thalita (feminina, multilíngue)" },
];

export function Ajustes({ estado, aoMudar }: { estado: Estado | null; aoMudar: () => void }) {
  const [v, setV] = useState<Record<string, string>>({});
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => { if (estado && !Object.keys(v).length) setV(estado.ajustes); }, [estado]);

  const salvar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    try {
      await api.salvarAjustes({ handle: v.handle ?? "", hashtags: v.hashtags ?? "", voz: v.voz ?? "", cerebro: v.cerebro ?? "claude" });
      setSalvo(true); setTimeout(() => setSalvo(false), 1500); aoMudar();
    } catch (e) { setErro((e as Error).message); }
  };

  return (
    <section className="pagina">
      <header className="cabeca">
        <h1>Ajustes</h1>
        <p>O @ entra pequeno no rodapé de todo vídeo. As hashtags padrão o Claude usa quando não tiver outra melhor.</p>
      </header>
      <form className="cartao ajustes" onSubmit={salvar}>
        <label>@ do perfil<input value={v.handle ?? ""} onChange={(e) => setV({ ...v, handle: e.target.value })} placeholder="@gta6cortesbr" /></label>
        <label>Hashtags padrão<input value={v.hashtags ?? ""} onChange={(e) => setV({ ...v, hashtags: e.target.value })} /></label>
        <label>Quem escolhe os momentos
          <select value={v.cerebro ?? "claude"} onChange={(e) => setV({ ...v, cerebro: e.target.value })}>
            <option value="claude">Claude (Claude Code)</option>
            <option value="codex">Codex</option>
            <option value="manual">Eu, na mão</option>
          </select>
        </label>
        <label>Voz das dicas narradas
          <select value={v.voz ?? ""} onChange={(e) => setV({ ...v, voz: e.target.value })}>
            {VOZES.map((x) => <option key={x.id} value={x.id}>{x.rotulo}</option>)}
          </select>
        </label>
        <button className="btn btn-forte" type="submit">{salvo ? "Salvo" : "Salvar"}</button>
        {erro && <div className="alerta alerta-erro">{erro}</div>}
      </form>
    </section>
  );
}
