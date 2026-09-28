# runlocally

## 日本語

**ZIP ワークベンチ**は、ブラウザだけで ZIP を開き、直し、作り直すためのアプリです。ファイルをアップロードせずに使えるよう開発中です。内部エンジンには ZIP の一覧・抽出・再構築・作成・分割・結合・修復と、RAR／7z／tar／tar.gz の一覧・展開があります。UI はまだ接続されておらず、公開可能な画面は準備中ページです。

### 4 つの公約

1. クライアントからの追加送信なし — DevTools の Network タブで確認できます。
2. オフラインで動作する — DevTools の Offline モードで確認できます。
3. PWA としてインストール可能 — ブラウザのインストール導線と Lighthouse PWA audit で確認できます。
4. 脆弱性報告経路を維持する — [SECURITY.md](SECURITY.md) と GitHub Private Vulnerability Reporting で確認できます。

正確な文言は [原則](docs/PRINCIPLES.md) を参照してください。ZIP の利用者向け機能・Service Worker・PWA は未実装です。公約の自動検証は P5 で CI に追加予定です。

### 開発

Node.js 24 以上が必要です。依存の導入後は以下を実行します。

```sh
npm ci
npm run dev
npm run ci
```

単体テストは `npm run test:unit -- --coverage` で実行します。エンジンの coverage 閾値は lines・functions・statements が 80%、branches が 75% です。`npm run check:engine-dom` はエンジン内の DOM 参照を検査します。公開 API と終了責任は [エンジン文書](docs/ENGINE.md) を参照してください。第三者帰属は解析用ビルドの sourcemap と静的コピー対象から配布コードを特定し、`npm run notice:generate` で [NOTICE](NOTICE.md) を再生成、`npm run notice:check` で一致を検査します。これらの検査は `npm run ci` に含まれます。

セルフホスト用 Docker は v0.4.0 で提供予定です。

ライセンス: [MIT](LICENSE)。

Colophon: Some code was written with AI assistance; all review and decisions are the maintainer's. 一部のコードは AI の支援を受けて書かれました。レビューと判断はすべてメンテナーが行っています。

## English

**ZIP Workbench** is an app being developed to open, fix and repack ZIP files entirely in the browser, without uploading files. Its internal engine supports ZIP listing, extraction, rewriting, creation, splitting, merging and recovery, plus listing and extraction of RAR, 7z, tar and tar.gz archives. The UI is not connected yet; the only available page is the coming soon page.

The four promises are no additional client requests, offline use, PWA installation and a maintained vulnerability reporting path. Check them through DevTools Network, DevTools Offline, the browser install prompt and Lighthouse PWA audit, and [SECURITY.md](SECURITY.md) with Private Vulnerability Reporting, respectively. See the exact wording in [Principles](docs/PRINCIPLES.md). User-facing ZIP features, the Service Worker and PWA support are not implemented yet; automated checks for the promises are planned for P5 CI.

Development requires Node.js 24 or newer: run `npm ci`, `npm run dev` and `npm run ci`. Self-hosting with Docker is planned for v0.4.0. License: [MIT](LICENSE).

Run unit tests with `npm run test:unit -- --coverage`. Engine coverage thresholds are 80% for lines, functions and statements, and 75% for branches. `npm run check:engine-dom` checks for DOM references in the engine. See the [engine API](docs/ENGINE.md) for signatures and cleanup responsibilities. The notice generator identifies browser-delivered code from analysis-build sourcemaps and statically copied assets. Regenerate [NOTICE](NOTICE.md) with `npm run notice:generate` and verify it with `npm run notice:check`. These checks are part of `npm run ci`.
