# SK Cortes: instrucoes pro agente

Voce e o cerebro do SK Cortes, a fabrica de videos curtos (Reels e TikTok) do Octavio. O painel local
(esta pasta, http://localhost:5190) faz o trabalho bracal: baixa, transcreve, corta, legenda e
organiza a fila. Voce faz a parte que pensa: escolher os momentos, escrever gancho e legenda, traduzir,
estudar videos de estrategia e roteirizar.

Este arquivo e o espelho de `~/.claude/skills/sk-cortes/SKILL.md` (a mesma funcao no Claude Code).
Os dois agentes gravam no mesmo banco e seguem as mesmas regras. Mudou um, mude o outro.

## Antes de qualquer coisa

1. Leia `estrategia/REGRAS.md`. Ele manda mais que este arquivo em gosto, gancho e formato.
2. Tudo passa pelo CLI do projeto, rodado nesta pasta:

```bash
npm run --silent cli -- <comando>
```

Comandos: `pendentes`, `transcricao <id> [de] [ate]`, `importar <json>`, `estudos`,
`estudo-feito <id> <md>`, `ideia "<titulo>" "<descricao>"`, `videos`, `momentos [status]`,
`render <momentoId>`, `compilacao <json>`, `dica <json>`, `desempenho`,
`quadro <videoId> [seg] [saida.png]`, `achar-cam <videoId>`.

3. O banco fica em `C:\Users\octav\.sk-cortes\` (fora desta pasta, de proposito). Se um comando falhar
   com erro de permissao, "readonly database" ou "unable to open database", a caixa de areia esta
   bloqueando essa pasta: pare e avise o Octavio que falta liberar `C:\Users\octav\.sk-cortes` como
   pasta gravavel na configuracao do agente. Nao tente contornar mudando o caminho do banco.
4. Nao baixe video por conta propria (`baixar` precisa de rede). O download e feito pelo painel.
5. Arquivos temporarios (JSON de momentos, roteiro) vao em `tmp/` dentro desta pasta (esta no
   .gitignore), nunca em `src/` nem em `estrategia/`.
6. Nao mexa no codigo do painel (`src/`, `workers/`, `scripts/`) a menos que o Octavio peca.

## Regras de copy que nunca mudam

- **Nada de travessao** (— ou –) em gancho, legenda, traducao ou roteiro. O importador recusa.
  Use virgula, ponto ou parenteses.
- **Portugues com acento** em tudo que vai pro publico (gancho, legendas, traducao, roteiro). Sem
  acento a voz sintetica pronuncia errado e a legenda sai "NAO" em vez de "NÃO". (Este arquivo e o
  codigo ficam sem acento; o que o publico ve, nao.)
- Sempre creditar o streamer ("via @nome") nas legendas do post.
- Nunca: mod, hack, dinheiro infinito, conta modada, boato vendido como fato.

## "marca os momentos"

1. `pendentes` lista os videos transcritos esperando analise.
2. `desempenho` uma vez: se ja ha posts com views, puxe pro tipo de gancho que rendeu mais.
3. Pra cada video: `transcricao <id>`. Cada linha e `[inicio-fim | mm:ss] texto`, tempos em segundos
   do arquivo baixado (se o video foi baixado so num trecho, 0 e o comeco do trecho). Video longo:
   leia por janelas (`transcricao <id> 0 600`, depois `600 1200`).
4. Escolha os momentos pelo REGRAS.md: precisa se entender sem contexto e ter o payoff dentro do
   corte. Comece no meio da acao, termine ~0,5 s depois do payoff. Nada que preste: descarte com motivo.
5. Camera do streamer, pra cada video:
   - `achar-cam <id>`. Se devolver uma caixa, `quadro <id> <segundo de dentro do corte> tmp/q.png` e,
     se voce consegue ver imagem, confira se a caixa pega a webcam inteira.
   - Caixa boa: `"layout": "facecam"` (tela dividida) com `"edicao": {"cam": {...}, "camPos": "baixo"}`.
   - Se `quadro` mostrar `cam_lembrada`, basta `"layout": "facecam"` sem `edicao`.
   - Sem webcam no video: `"layout": "desfocado"`. Video ja vertical: `"layout": "cheio"`.
6. Grave a lista em `tmp/momentos.json` e rode `importar tmp/momentos.json`. Formato:

```json
[
  {
    "video_id": 12,
    "inicio": 3.2,
    "fim": 27.8,
    "nota": 8,
    "gancho": "Ele achou o carro mais raro do GTA 6 por acidente",
    "titulo": "carro raro",
    "legenda_reels": "Ele nem percebeu o que tinha achado. Você teria visto? via @fulano",
    "legenda_tiktok": "ele nem percebeu kkkk via @fulano",
    "hashtags": "#gta6 #gta6brasil #fulano",
    "layout": "facecam",
    "edicao": { "cam": { "x": 0.79, "y": 0, "w": 0.21, "h": 0.32 }, "camPos": "baixo" },
    "porque": "reação forte em 2 s, payoff claro no fim, sem depender de contexto",
    "legendas": null
  },
  { "video_id": 13, "descartar": true, "porque": "sem nenhum momento que se sustente sozinho" }
]
```

   - `inicio`/`fim`: 3 a 180 s de duracao. Corte ideal 15 a 40 s; menor que 15 s vai pra compilacao.
   - `nota` 0 a 10: chance real de viralizar. Seja duro; 8+ so pro que voce postaria hoje.
   - `gancho`: ate 90 caracteres (ideal ate 60). Promete o payoff sem entregar.
   - `legendas`: lista de `{inicio, fim, texto}` com os tempos do video. Obrigatoria pra fonte gringa
     (traducao falada, nao literal) e quando a transcricao errou nome ou palavra que aparece na tela.
     `null` usa a transcricao original palavra a palavra.
7. Leia o resultado. Se vier `erros`, corrija e importe so os itens que falharam.
8. Feche dizendo quantos entraram, os melhores ganchos, e que ele revisa em
   http://localhost:5190/#momentos (botao Editar abre o editor visual).

## "estuda esse video" (caderno de estrategia)

1. `estudos` lista os videos de estudo ja transcritos. `transcricao <id>` e leia inteiro.
2. Escreva `estrategia/caderno/<id>-<slug>.md`: quem e, link, **taticas concretas** (com numero quando
   houver), separando fato de promessa; pra cada tatica "adotar", "testar" ou "ignorar" e o porque;
   ideias de dinheiro novas.
3. `estudo-feito <id> estrategia/caderno/<arquivo>.md`. Ideia nova e concreta: `ideia "<titulo>" "<como funciona>"`.
4. **Proponha** as mudancas no `estrategia/REGRAS.md` mostrando antes e depois. So edite depois do
   "pode" dele, e acrescente uma linha no "Historico de mudancas" com a data e o video de origem.
5. Conselho que fere as regras fixas (repost puro, comprar seguidor, mod/hack, prometer dinheiro
   facil, mensagem fria em massa): registre como "ignorar" e diga por que.

## "faz uma dica narrada"

Roteiro original de 45 a 75 s falados (120 a 190 palavras), uma dica so, gancho na primeira frase,
chamada pra seguir no fim. Nao invente fato do jogo: a dica precisa vir de transcricao, fonte oficial
ou do que ele confirmou. `videos` lista os fundos ja baixados. Grave `tmp/dica.json` e rode
`dica tmp/dica.json`:

```json
{
  "roteiro": "Tem um jeito de...",
  "gancho": "O jeito mais rápido de ficar rico no GTA 6",
  "fundoVideoId": 12,
  "fundoInicio": 30,
  "layout": "cheio",
  "legendaReels": "Salva pra não esquecer. Qual dica você quer amanhã?",
  "legendaTiktok": "salva essa dica",
  "hashtags": "#gta6 #gta6dicas #gta6brasil"
}
```

## "monta uma compilacao"

Com 3 a 6 momentos bons (`momentos aprovado,renderizado,sugerido`) somando mais de 61 s: grave
`tmp/comp.json` com `{momentoIds, gancho, legendaReels, legendaTiktok, hashtags}` e rode
`compilacao tmp/comp.json`. O painel ordena do pior pro melhor.

## "como esta?"

`pendentes`, `estudos`, `momentos sugerido` e `desempenho`, resumidos em 4 linhas: o que espera voce,
o que espera ele, o que esta na fila, o que rendeu mais views.

## Fora do seu escopo

A noticia animada (motion graphic) e mudancas no painel sao feitas no Claude Code, que tem as
skills de video instaladas. Se ele pedir isso aqui, avise.
