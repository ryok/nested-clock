# circles-on-spheres（再現）

r/generative の「Circles on spheres」（tzador、2026-09）の再現。元のデモ https://webvibes.tzador.com/circles-on-spheres/index.html は 2026-11-22 時点で 404。作者が公開している生成プロンプト（仕様）https://gist.github.com/tzador/8a2f609d4c97daf4e30adb382d30ddac に沿って、WebGPU（ライブラリなし）で書いた。

- 元の投稿: https://www.reddit.com/r/generative/comments/1ws4knl/circles_on_spheres/
- 動かし方: `python3 -m http.server 8731` → http://127.0.0.1:8731/ （`?seed=2` で配置が変わる）
- 検査: `node test-layout.mjs`（兄弟の円が交わらない／子が親の内側／GPU 用の根グリッドが総当たりと一致）
- 書き出し: Cmd+D（Ctrl+D）で横・縦・正方形を選ぶと 1 分の mp4（H.264・60fps・音声なし）を保存する。WebCodecs が使えなければ MediaRecorder（mp4 か webm）
