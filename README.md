# Flappy Bird (PWA)

Przeglądarkowy port gry Flappy Bird z aplikacji na iOS: ta sama pętla gry (60 Hz, stałe kroki),
lokalny ranking z imieniem, wybór koloru ptaka i ekrany w stylu gry. Działa offline.

## Instalacja na telefonie

1. Otwórz https://tomo-ui.github.io/FlappyBird/ w Safari (iPhone) albo Chrome (Android).
2. iPhone: Udostępnij → **Dodaj do ekranu początkowego**. Android: menu → **Zainstaluj aplikację**.

## Uruchomienie lokalnie

```bash
python -m http.server 8000
```

Następnie otwórz http://localhost:8000/. Spacja lub dotyk = skok.

## Pliki

- `game.js` – logika gry (port `Game.swift`)
- `pixelfont.js`, `ui.js` – czcionka i ekrany rankingu / imienia / koloru
- `main.js` – rysowanie na canvasie, wejście, dźwięk
- `sw.js`, `manifest.webmanifest` – instalacja i tryb offline
