# runlocally

## 日本語

**ZIP ワークベンチ**は、ブラウザだけで ZIP を開き、直し、作り直すためのアプリです。ファイルをアップロードせずに使えるよう開発中です。内部エンジンには ZIP の一覧・抽出・再構築・作成・分割・結合・修復と、RAR／7z／tar／tar.gz の一覧・展開があります。画面では ZIP の閲覧・取り出し・削除・名前修復が使えます。RAR／7z／tar は閲覧・取り出しのみです。

### 4 つの公約

1. クライアントからの追加送信なし — DevTools の Network タブで確認できます。
2. オフラインで動作する — DevTools の Offline モードで確認できます。
3. PWA としてインストール可能 — ブラウザのインストール導線と Lighthouse PWA audit で確認できます。
4. 脆弱性報告経路を維持する — [SECURITY.md](SECURITY.md) と GitHub Private Vulnerability Reporting で確認できます。

正確な文言は [原則](docs/PRINCIPLES.md) を参照してください。Service Worker・PWA は未実装です。画面の状態と操作は [UI 文書](docs/UI.md) を参照してください。日本語・英語の top と4つの操作ページを公開し、言語や操作の切り替えで現在の File と処理結果を保持します。言語とページの追加手順は [I18N 文書](docs/I18N.md) を参照してください。公約の自動検証は P5 で CI に追加予定です。

### 開発

Node.js 24 以上が必要です。依存の導入後は以下を実行します。

```sh
npm ci
npm run dev
npm run ci
```

単体テストは `npm run test:unit -- --coverage`、部品テストは `npm run test:component` で実行します。Vitest は単体テストを Node、部品テストを jsdom で実行し、両方を CI で収集します。[部品の契約](src/ui/README.md)も参照してください。エンジンの coverage 閾値は lines・functions・statements が 80%、branches が 75% です。`npm run check:engine-dom` はエンジン内の DOM 参照を検査します。公開 API と終了責任は [エンジン文書](docs/ENGINE.md) を参照してください。第三者帰属は解析用ビルドの sourcemap と静的コピー対象から配布コードを特定し、`npm run notice:generate` で [NOTICE](NOTICE.md) を再生成、`npm run notice:check` で一致を検査します。これらの検査は `npm run ci` に含まれます。

セルフホスト用 Docker は v0.4.0 で提供予定です。

ライセンス: [MIT](LICENSE)。

Colophon: Some code was written with AI assistance; all review and decisions are the maintainer's.

## English

**ZIP Workbench** is an app being developed to open, fix and repack ZIP files entirely in the browser, without uploading files. Its internal engine supports ZIP listing, extraction, rewriting, creation, splitting, merging and recovery, plus listing and extraction of RAR, 7z, tar and tar.gz archives. The screen supports ZIP browsing, extraction, removal, and name repair. RAR, 7z, and tar support browsing and extraction only.

The four promises are no additional client requests, offline use, PWA installation and a maintained vulnerability reporting path. Check them through DevTools Network, DevTools Offline, the browser install prompt and Lighthouse PWA audit, and [SECURITY.md](SECURITY.md) with Private Vulnerability Reporting, respectively. See the exact wording in [Principles](docs/PRINCIPLES.md). The Service Worker and PWA support are not implemented yet; automated checks for the promises are planned for P5 CI. Japanese and English top and operation pages share the Workbench. Switching language or operation keeps the current File and results. See [UI behavior](docs/UI.md) for state and [I18N](docs/I18N.md) for adding languages and pages.

Development requires Node.js 24 or newer: run `npm ci`, `npm run dev` and `npm run ci`. Self-hosting with Docker is planned for v0.4.0. License: [MIT](LICENSE).

Run unit tests with `npm run test:unit -- --coverage` and component tests with `npm run test:component`. Vitest runs unit tests in Node and component tests in jsdom; CI collects both. See the [component contract](src/ui/README.md). Engine coverage thresholds are 80% for lines, functions and statements, and 75% for branches. `npm run check:engine-dom` checks for DOM references in the engine. See the [engine API](docs/ENGINE.md) for signatures and cleanup responsibilities. The notice generator identifies browser-delivered code from analysis-build sourcemaps and statically copied assets. Regenerate [NOTICE](NOTICE.md) with `npm run notice:generate` and verify it with `npm run notice:check`. These checks are part of `npm run ci`.
