# Contributing

Node.js 22 以上で `npm ci` を実行し、`npm run dev` で開発してください。変更を提出する前に `npm run ci` が通ることを確認してください。`npm install` 時に `.githooks` の pre-commit が自動設定され、コミット前に秘密の漏洩検査を実行します。個人用の検査パターンは、必要に応じて gitignore 済みの `.leak-patterns.local` に 1 行ずつ設定できます。

依存を追加する場合は許可されたライセンスのみを使用してください。LGPL の依存は外部 `.wasm` として配信し、NOTICE への帰属とリビルド手順を保持する必要があります。GPL と AGPL は採用しません。許可ライセンスの一覧は `package.json` の `license:check` を参照してください。

[4 つの公約](docs/PRINCIPLES.md) に反する外部送信、追跡、CDN 読み込みなどの変更は受け付けません。[行動規範](CODE_OF_CONDUCT.md) も参照してください。
