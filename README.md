# nested clock

曲の入れ子を、球の上の入れ子の円にした AV 作品（RIOKADA、2026-11）。曲 → セクション → 和音 → ループの1周期 → 小分け → 音。円の大きさはその長さで決まり、鳴っているあいだだけ、自分の長さでちょうど1周する。音の円は鳴る前は輪で、鳴っているあいだに内側が満ち、鳴り終わると塗りつぶしになる。

A song's structure as nested circles on a sphere. Each circle turns exactly once over its own duration, only while it is sounding.

Inspired by "Circles on spheres" by tzador（r/generative、2026-09）https://www.reddit.com/r/generative/comments/1ws4knl/circles_on_spheres/

## 作品（`song.html`）

- `score-gen.mjs` → `score.json` が唯一の正。ノートと木（親子は明示し、時間から推測しない）を両方持つ。`node score-gen.mjs [seed] > score.json`（既定 seed 7、決定的）
- 曲: 84BPM・188拍、D ドリアン。4拍子のドラムの上で 7拍のベース・5拍のマリンバ・3拍のプラックが、和音が変わるたびにそろって始まり、和音の終わりで切れる。和音の長さは 2〜16 拍
- `push-live.mjs --first <track> --slot <n> [--load] [--arrange] [--verify]`: [ableton-cli](https://github.com/ryok/ableton-cli) で Ableton Live に打ち込み、全ノートを読み戻して楽譜と照合する
- `test-songtree.mjs`: 配置の検査（兄弟の円が交わらない／子が親の内側／GPU 用の根グリッドが総当たりと一致）
- 音: Live から書き出した WAV を `song.wav` に置く（1.1.1 から、楽譜の拍数＋余韻）。あれば AudioContext の再生時刻を時計にして同期する。無ければ画面の時計で、音なしで回る（WAV はリポジトリに含めていない）
- 書き出し: `song.html?export=landscape`（`portrait`／`square`）で t = フレーム番号/60 のオフライン描画をして mp4 を保存する。音は ffmpeg で合わせる:
  `ffmpeg -i nested-clock-landscape.mp4 -i song.wav -c:v copy -c:a aac -b:a 320k -shortest nested-clock.mp4`
- `ableton/nested_clock Project/nested_clock.als`: 曲の Live セット（Live 付属の音色だけ）

## 再現（`index.html`）

作品の土台にした、元作品の再現。元のデモ https://webvibes.tzador.com/circles-on-spheres/index.html は 2026-11-22 時点で 404。作者が公開している生成用の仕様（コードではなく文章）https://gist.github.com/tzador/8a2f609d4c97daf4e30adb382d30ddac に沿って、WebGPU（ライブラリなし）で書いた。配置・回転・配色はこの仕様のもので、作品側（`song.html`）では配置と回転を曲から決め直している。

- 検査: `node test-layout.mjs`
- 書き出し: Cmd+D（Ctrl+D）で横・縦・正方形を選ぶと 1 分の mp4（H.264・60fps・音声なし）を保存する

## 動かし方

```
python3 -m http.server 8731
```

- 作品: http://127.0.0.1:8731/song.html （`?seed=` で配置が変わる。`?t=60` でその秒から）
- 再現: http://127.0.0.1:8731/ （`?seed=2` で配置が変わる）
- WebGPU が使えるブラウザ（Chrome など）が必要
