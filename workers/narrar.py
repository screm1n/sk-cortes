"""Gera a narracao de uma dica com edge-tts (gratis) e o tempo de cada palavra.

uso: python narrar.py <roteiro.txt> <voz> <saida.mp3> <palavras.json> [velocidade]

palavras.json: {"palavras": [{"i", "f", "w"}]} em segundos, pra legenda palavra a palavra.
"""
import asyncio
import json
import sys

import edge_tts


async def main() -> None:
    roteiro_arq, voz, mp3, saida = sys.argv[1:5]
    velocidade = sys.argv[5] if len(sys.argv) > 5 else "+8%"
    with open(roteiro_arq, encoding="utf-8") as f:
        texto = f.read().strip()

    com = edge_tts.Communicate(texto, voz, rate=velocidade, boundary="WordBoundary")
    palavras = []
    with open(mp3, "wb") as audio:
        async for parte in com.stream():
            if parte["type"] == "audio":
                audio.write(parte["data"])
            elif parte["type"] == "WordBoundary":
                ini = parte["offset"] / 1e7
                palavras.append({"i": round(ini, 3), "f": round(ini + parte["duration"] / 1e7, 3), "w": parte["text"]})

    with open(saida, "w", encoding="utf-8") as f:
        json.dump({"palavras": palavras}, f, ensure_ascii=False)


if __name__ == "__main__":
    asyncio.run(main())
