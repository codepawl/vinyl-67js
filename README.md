<p align="center">
  <a href="https://codepawl.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/codepawl/.github/main/brand/codepawl-lockup-dark.png">
      <img alt="CodePawl" src="https://raw.githubusercontent.com/codepawl/.github/main/brand/codepawl-lockup.png" width="200">
    </picture>
  </a>
</p>

<h1 align="center">vinyl-67js</h1>

Three record players (1877 phonograph, 1925 gramophone, 1979 direct drive) that play real records in the browser, drawn with 67js. Live at https://vinyl.codepawl.com.

The sound engine, record cutting and records come from [rauchg/vinyl](https://github.com/rauchg/vinyl) (MIT, licence text in `LICENSE-rauchg-vinyl.txt`). Model credits are in `credits.json`.

## Run

```
npm start        # http://localhost:4173
npm run deploy   # builds dist and deploys the Cloudflare Worker
```

The folders `67js`, `assets`, `records`, `renders` and `dist` are not in this repository. `67js` is the built library from `anxuanng/67.js`; `assets/models` holds the three GLB files made by `tools/prep_player.py`; `records` holds the prebuilt records from rauchg/vinyl.

<br>

<p align="center">
  <sub>Made by CodePawl, an independent 3D studio in Vietnam.</sub>
  <br>
  <sub>
    <a href="https://codepawl.com">Website</a> |
    <a href="https://x.com/codepawl">X</a> |
    <a href="https://github.com/codepawl">GitHub</a> |
    <a href="https://huggingface.co/codepawl">Hugging Face</a> |
    <a href="https://www.youtube.com/@codepawlhq">YouTube</a> |
    <a href="https://www.threads.com/@codepawl">Threads</a>
  </sub>
</p>
