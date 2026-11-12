"""Transcreve um video/audio com faster-whisper e grava JSON com tempo de cada palavra.

uso: python transcrever.py <entrada> <saida.json> [idioma|auto] [modelo]

Saida: {"idioma", "duracao", "segmentos": [{"i", "f", "t", "p": [{"i", "f", "w"}]}]}
Imprime {"progresso": 0..1} a cada segmento pro painel mostrar a barra.
"""
import json
import os
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel

FFMPEG = os.environ.get("FFMPEG", "ffmpeg")


def carregar_audio(arquivo: str) -> np.ndarray:
    """Decodifica com o ffmpeg em vez do PyAV: a versao do av instalada nao aceita
    o argumento que o faster-whisper passa (metadata_errors). Array numpy contorna."""
    bruto = subprocess.run(
        [FFMPEG, "-nostdin", "-v", "error", "-i", arquivo, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(bruto, np.int16).astype(np.float32) / 32768.0


def main() -> None:
    entrada, saida = sys.argv[1], sys.argv[2]
    idioma = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] not in ("", "auto") else None
    modelo = sys.argv[4] if len(sys.argv) > 4 else "small"

    # CPU com int8: a placa do PC nao tem CUDA no torch, e int8 e o mais rapido em CPU.
    m = WhisperModel(modelo, device="cpu", compute_type="int8")
    segs, info = m.transcribe(carregar_audio(entrada), language=idioma, word_timestamps=True, vad_filter=True)

    out = {"idioma": info.language, "duracao": round(info.duration, 2), "segmentos": []}
    for s in segs:
        out["segmentos"].append({
            "i": round(s.start, 2),
            "f": round(s.end, 2),
            "t": s.text.strip(),
            "p": [{"i": round(w.start, 2), "f": round(w.end, 2), "w": w.word.strip()}
                  for w in (s.words or []) if w.word.strip()],
        })
        if info.duration:
            print(json.dumps({"progresso": min(1.0, s.end / info.duration)}), flush=True)

    with open(saida, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
