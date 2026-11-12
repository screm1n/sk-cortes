# SK Cortes

Fabrica de videos de GTA 6 pra Reels e TikTok. Painel local que baixa, transcreve, corta em 9:16,
legenda palavra a palavra e organiza a fila de postagem. Quem escolhe os momentos, escreve gancho,
traduz, roteiriza e aprende com os videos de estudo e o Claude Code, pela skill `/sk-cortes`
(sem API paga).

## Rodar

```bash
npm install
npm run dev
```

Painel em http://localhost:5190 (abre no celular pela rede local tambem). API na 5191.
No Claude desktop: `preview_start` com o nome `sk-cortes`.

Banco e midia ficam em `~/.sk-cortes/`, fora do OneDrive de proposito.

## Fluxo do dia

1. **Fontes**: cadastra os streamers. "Buscar novos" traz os clips mais vistos da semana (Twitch)
   ou os videos recentes (YouTube).
2. **Radar**: baixar (ou colar link avulso, ate de um trecho de live). Baixa e transcreve sozinho.
3. No Claude Code: `/sk-cortes momentos`. O Claude le as transcricoes, aplica o
   `estrategia/REGRAS.md` e grava os momentos.
4. **Momentos**: "Editar" abre o editor visual. Linha do tempo pra cortar, tres modelos (tela
   dividida, fundo desfocado, tela cheia), caixas arrastaveis pra camera do streamer e pro jogo,
   previa 9:16 ao vivo e correcao das falas. Marque varios pra compilacao de 61 s ou mais (o TikTok
   so paga video com mais de 1 minuto).
5. **Fila**: baixa o mp4, copia a legenda, posta. Depois cola link e views.
6. **Caderno**: cola video de quem ensina a ganhar dinheiro com GTA 6 e roda `/sk-cortes aprender`.
   As taticas viram proposta de regra nova.

Outros formatos: `/sk-cortes dica` (narracao edge-tts sobre gameplay) e `/sk-cortes noticia`
(motion graphic com HyperFrames).

## Pecas

- `src/compartilhado/geometria.ts`: a conta do enquadramento 9:16. O servidor usa pra montar o filtro
  do ffmpeg e o editor usa pra desenhar a previa, entao a previa e o mp4 saem iguais
- `src/web/pages/Editor.tsx`: o editor do corte
- `src/server/fabrica/`: legenda ASS (`ass.ts`), filtros 9:16 (`filtros.ts`), render (`render.ts`)
- `src/server/momentos.ts`: contrato do JSON que o Claude grava (recusa travessao, fonte que nao libera,
  corte fora do video)
- `scripts/cli.ts`: ponte pra skill (`npm run cli -- <comando>`)
- `workers/`: transcricao (faster-whisper, audio decodificado pelo ffmpeg), narracao (edge-tts) e
  detector da webcam do streamer (`achar_cam.py`, OpenCV: rosto parado + area que nao muda)
- `estrategia/REGRAS.md`: playbook vivo; `estrategia/caderno/`: analises dos videos estudados

`npm test` roda os testes (nenhum toca rede).
