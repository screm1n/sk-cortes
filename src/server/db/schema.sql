-- Idempotente: roda a cada boot e faz as vezes de migracao.

CREATE TABLE IF NOT EXISTS fontes (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  plataforma TEXT NOT NULL,              -- twitch | youtube | kick | tiktok | outro
  url TEXT NOT NULL UNIQUE,
  idioma TEXT NOT NULL DEFAULT 'pt',
  origem TEXT NOT NULL DEFAULT 'br',     -- br | gringo
  libera TEXT NOT NULL DEFAULT '?',      -- sim | nao | ?  (o streamer libera cortes?)
  facecam TEXT,                          -- JSON {x,y,w,h} em fracao 0..1 do quadro
  notas TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY,
  fonte_id INTEGER REFERENCES fontes(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL DEFAULT 'corte',    -- corte | estudo
  url TEXT NOT NULL UNIQUE,
  titulo TEXT,
  autor TEXT,
  plataforma TEXT,
  duracao REAL,
  views INTEGER,
  publicado_em TEXT,
  idioma TEXT,
  largura INTEGER,
  altura INTEGER,
  arquivo TEXT,
  transcricao TEXT,
  analise TEXT,                          -- caminho do .md do caderno (estudos)
  trecho TEXT,                           -- JSON [de, ate] em segundos, quando baixou so um pedaco
  -- novo | baixando | baixado | transcrevendo | transcrito | analisado | descartado | erro
  status TEXT NOT NULL DEFAULT 'novo',
  erro TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS videos_status ON videos(tipo, status);

CREATE TABLE IF NOT EXISTS momentos (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  inicio REAL NOT NULL,
  fim REAL NOT NULL,
  nota INTEGER NOT NULL DEFAULT 5,       -- 0..10, chance de viralizar na opiniao do Claude
  gancho TEXT NOT NULL,
  titulo TEXT,
  legenda_reels TEXT,
  legenda_tiktok TEXT,
  hashtags TEXT,
  legendas TEXT,                         -- JSON [{inicio,fim,texto}] em PT; null = usa a transcricao
  layout TEXT NOT NULL DEFAULT 'desfocado',  -- desfocado | facecam (tela dividida) | cheio
  edicao TEXT,                           -- JSON do editor: recortes de camera/jogo, posicao, zoom
  porque TEXT,
  status TEXT NOT NULL DEFAULT 'sugerido',   -- sugerido | aprovado | descartado | renderizado
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS renders (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL,                    -- curto | compilacao | dica
  momentos TEXT,                         -- JSON de ids
  arquivo TEXT,
  duracao REAL,
  gancho TEXT,
  legenda_reels TEXT,
  legenda_tiktok TEXT,
  hashtags TEXT,
  status TEXT NOT NULL DEFAULT 'renderizando',  -- renderizando | pronto | postado | erro
  erro TEXT,
  link_reels TEXT,
  link_tiktok TEXT,
  views_reels INTEGER,
  views_tiktok INTEGER,
  postado_em TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ideias (
  id INTEGER PRIMARY KEY,
  titulo TEXT NOT NULL UNIQUE,
  descricao TEXT,
  status TEXT NOT NULL DEFAULT 'ideia',  -- ideia | testando | rodando | descartada
  origem TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ajustes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
