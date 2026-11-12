"""Acha a camera do streamer num video.

1. Procura um rosto que fica parado no mesmo lugar em varios quadros (rosto de
   personagem do jogo muda de lugar, o da webcam nao).
2. Cresce uma caixa a partir do rosto enquanto a imagem em volta for "parada": o
   fundo da webcam quase nao muda de um quadro pro outro, o jogo muda o tempo todo.

uso: python achar_cam.py <video>
Saida: {"cam": {"x","y","w","h"}} em fracao do quadro, ou {"cam": null}.
"""
import json
import sys

import cv2
import numpy as np

LARG_ANALISE = 320


def main() -> None:
    cap = cv2.VideoCapture(sys.argv[1])
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    larg = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1
    alt = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1
    detector = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

    amostras = 16
    rostos = []  # (cx, cy, w, h) em fracao
    pequenos = []
    for k in range(amostras):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * (k + 0.5) / amostras))
        ok, quadro = cap.read()
        if not ok:
            continue
        cinza = cv2.cvtColor(quadro, cv2.COLOR_BGR2GRAY)
        pequenos.append(cv2.resize(cinza, (LARG_ANALISE, int(alt * LARG_ANALISE / larg)), interpolation=cv2.INTER_AREA))
        minimo = max(24, int(alt * 0.05))
        for (x, y, w, h) in detector.detectMultiScale(cinza, scaleFactor=1.1, minNeighbors=6, minSize=(minimo, minimo)):
            rostos.append(((x + w / 2) / larg, (y + h / 2) / alt, w / larg, h / alt))
    cap.release()

    melhor = []
    for r in rostos:
        grupo = [o for o in rostos if abs(o[0] - r[0]) < 0.05 and abs(o[1] - r[1]) < 0.07]
        if len(grupo) > len(melhor):
            melhor = grupo
    if len(melhor) < 3 or len(pequenos) < 4:
        print(json.dumps({"cam": None}))
        return
    cx, cy, fw, fh = [sorted(v[i] for v in melhor)[len(melhor) // 2] for i in range(4)]

    pilha = np.stack(pequenos).astype(np.float32)
    parado = pilha.std(axis=0) < 14.0
    H, W = parado.shape

    # Comeca no rosto e cresce um pixel por vez pra cada lado enquanto a nova linha for parada.
    # O ponto de partida ja inclui os ombros: o corpo se mexe, e uma caixa so do rosto
    # ficaria cercada de "movimento" e nunca cresceria.
    x0, x1 = max(0, int((cx - fw * 1.2) * W)), min(W, int((cx + fw * 1.2) * W))
    y0, y1 = max(0, int((cy - fh * 0.9) * H)), min(H, int((cy + fh * 1.3) * H))
    partida = (x1 - x0, y1 - y0)
    max_w, max_h = int(fw * 9 * W), int(fh * 7 * H)
    cresceu = True
    while cresceu:
        cresceu = False
        if x0 > 0 and x1 - x0 < max_w and parado[y0:y1, x0 - 1].mean() >= 0.6:
            x0 -= 1; cresceu = True
        if x1 < W and x1 - x0 < max_w and parado[y0:y1, x1].mean() >= 0.6:
            x1 += 1; cresceu = True
        if y0 > 0 and y1 - y0 < max_h and parado[y0 - 1, x0:x1].mean() >= 0.6:
            y0 -= 1; cresceu = True
        if y1 < H and y1 - y0 < max_h and parado[y1, x0:x1].mean() >= 0.6:
            y1 += 1; cresceu = True

    fx0, fy0, fx1, fy1 = x0 / W, y0 / H, x1 / W, y1 / H
    # Nao cresceu quase nada (webcam sem moldura parada, ex. fundo verde): chuta pelo rosto.
    if x1 - x0 <= partida[0] + 2 and y1 - y0 <= partida[1] + 2:
        fx0, fx1 = cx - fw * 1.6, cx + fw * 1.6
        fy0, fy1 = cy - fh * 1.2, cy + fh * 1.6
    fx0, fy0, fx1, fy1 = max(0.0, fx0), max(0.0, fy0), min(1.0, fx1), min(1.0, fy1)
    if fx0 < 0.03: fx0 = 0.0
    if fy0 < 0.03: fy0 = 0.0
    if fx1 > 0.97: fx1 = 1.0
    if fy1 > 0.97: fy1 = 1.0
    print(json.dumps({"cam": {"x": round(fx0, 4), "y": round(fy0, 4), "w": round(fx1 - fx0, 4), "h": round(fy1 - fy0, 4)}}))


if __name__ == "__main__":
    main()
