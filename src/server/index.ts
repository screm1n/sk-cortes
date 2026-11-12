import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config, raizProjeto } from "./config.ts";
import { db } from "./db/client.ts";
import { rotas } from "./rotas.ts";

const app = Fastify({ logger: { level: "warn" } });

db();
await app.register(rotas);

// Videos baixados e renders, com suporte a Range (o player do navegador pula no tempo).
await app.register(fastifyStatic, { root: config.dados, prefix: "/midia/", decorateReply: false });

const dist = join(raizProjeto, "dist");
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api")) return reply.code(404).send({ erro: "rota nao encontrada" });
    return reply.sendFile("index.html");
  });
}

await app.listen({ port: config.porta, host: "0.0.0.0" });
console.log(`\n  SK Cortes no ar em http://localhost:${config.porta}\n  dados: ${config.dados}\n`);
