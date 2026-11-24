# circles-on-spheres（再現）

r/generative の「Circles on spheres」（tzador、2026-09）の再現。元のデモ https://webvibes.tzador.com/circles-on-spheres/index.html は 2026-11-22 時点で 404。作者が公開している生成プロンプト（仕様）https://gist.github.com/tzador/8a2f609d4c97daf4e30adb382d30ddac に沿って、WebGPU（ライブラリなし）で書いた。

- 元の投稿: https://www.reddit.com/r/generative/comments/1ws4knl/circles_on_spheres/
- 動かし方: `python3 -m http.server 8731` → http://127.0.0.1:8731/ （`?seed=2` で配置が変わる）
- 検査: `node test-layout.mjs`（兄弟の円が交わらない／子が親の内側／GPU 用の根グリッドが総当たりと一致）
- 書き出し: Cmd+D（Ctrl+D）で横・縦・正方形を選ぶと 1 分の mp4（H.264・60fps・音声なし）を保存する。WebCodecs が使えなければ MediaRecorder（mp4 か webm）

## Nested clock（`song.html`）

The work built on top of the reproduction: a song's structure as nested circles. Each circle turns exactly once over its own duration while it is sounding.

- `score-gen.mjs` → `score.json` is the single source of truth (notes, and the tree: section → chord → loop cycle → sub-group → note, parents explicit).
- `push-live.mjs --first <track> --slot <n> [--arrange]` writes the score into Ableton Live via `ableton` CLI and reads every note back to diff.
- `test-songtree.mjs` checks the packed layout (siblings disjoint, kids inside parents, root grid = brute force).
- Put the bounced audio at `song.wav` (start at 1.1.1, length = score beats + tail). The page then uses the AudioContext clock.
- `song.html?export=landscape` renders offline at t = frame / 60 and downloads `nested-clock-landscape.mp4`. Mux the audio:
  `ffmpeg -i nested-clock-landscape.mp4 -i song.wav -c:v copy -c:a aac -b:a 320k -shortest nested-clock.mp4`
