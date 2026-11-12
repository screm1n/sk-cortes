-- So insere o que falta: nunca sobrescreve o que ele editou no painel.

INSERT OR IGNORE INTO ajustes (chave, valor) VALUES
  ('handle', '@seuperfil'),
  ('hashtags', '#gta6 #gta #gtavi #gamer #games'),
  ('voz', 'pt-BR-AntonioNeural'),
  ('cerebro', 'claude');

INSERT OR IGNORE INTO ideias (titulo, descricao, status, origem) VALUES
  ('Perfil de cortes + dicas + noticias', 'Reels e TikTok ao mesmo tempo. Corte puxa view, dica narrada e noticia monetizam (conteudo transformado). Compilacao de 61 a 90 s pro TikTok pagar.', 'rodando', 'plano inicial'),
  ('Guia GTA 6 low ticket', 'Rotas de dinheiro, segredos e 100% montados a partir das transcricoes do Radar. Pagina + checkout Payt, reaproveitar o fluxo do /automatico. Montar na semana do lancamento.', 'ideia', 'plano inicial'),
  ('Mapa interativo de segredos', 'Site com colecionaveis e segredos. Gratis puxa trafego, versao completa paga ou vira bonus do guia.', 'ideia', 'plano inicial'),
  ('Edicao de cortes pra streamer pequeno', 'Servico mensal pra streamer BR que vai jogar GTA 6 e nao tem editor. Mesma fabrica, outro cliente.', 'ideia', 'plano inicial'),
  ('Campanhas de clipping pagas', 'Whop Content Rewards e parecidos: streamer ou marca paga por mil views dos cortes. Renda paralela com a mesma fabrica.', 'ideia', 'plano inicial'),
  ('Afiliado de console e acessorios', 'Link de afiliado (Shopee, Mercado Livre, Amazon) de console, controle e headset na bio e nas legendas.', 'ideia', 'plano inicial');
