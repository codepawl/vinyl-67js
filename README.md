# vinyl-67js

Three record players (1877 phonograph, 1925 gramophone, 1979 direct drive) that play real records in the browser, drawn with 67js. Live at https://vinyl.codepawl.com.

The sound engine, record cutting and records come from [rauchg/vinyl](https://github.com/rauchg/vinyl) (MIT, licence text in `LICENSE-rauchg-vinyl.txt`). Model credits are in `credits.json`.

## Run

```
npm start        # http://localhost:4173
npm run deploy   # builds dist and deploys the Cloudflare Worker
```

The folders `67js`, `assets`, `records`, `renders` and `dist` are not in this repository. `67js` is the built library from `anxuanng/67.js`; `assets/models` holds the three GLB files made by `tools/prep_player.py`; `records` holds the prebuilt records from rauchg/vinyl.
