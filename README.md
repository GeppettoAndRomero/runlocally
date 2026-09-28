# runlocally

## 日本語

**ZIP ワークベンチ**は、ブラウザだけで ZIP を開き、直し、作り直すためのアプリです。ファイルをアップロードせずに使えるよう開発中です。現在は準備中ページのみ公開可能な骨格です。

### 4 つの公約

1. クライアントからの追加送信なし — DevTools の Network タブで確認できます。
2. オフラインで動作する — DevTools の Offline モードで確認できます。
3. PWA としてインストール可能 — ブラウザのインストール導線と Lighthouse PWA audit で確認できます。
4. 脆弱性報告経路を維持する — [SECURITY.md](SECURITY.md) と GitHub Private Vulnerability Reporting で確認できます。

正確な文言は [原則](docs/PRINCIPLES.md) を参照してください。現在、ZIP 機能・Service Worker・PWA は未実装です。公約の自動検証は P5 で CI に追加予定です。

### 開発

Node.js 22 以上が必要です。依存の導入後は以下を実行します。

```sh
npm ci
npm run dev
npm run ci
```

セルフホスト用 Docker は v0.4.0 で提供予定です。

ライセンス: [MIT](LICENSE)。

Colophon: Some code was written with AI assistance; all review and decisions are the maintainer's. 一部のコードは AI の支援を受けて書かれました。レビューと判断はすべてメンテナーが行っています。

## English

**ZIP Workbench** is an app being developed to open, fix and repack ZIP files entirely in the browser, without uploading files. The repository currently contains only a coming soon page and project scaffolding.

The four promises are no additional client requests, offline use, PWA installation and a maintained vulnerability reporting path. Check them through DevTools Network, DevTools Offline, the browser install prompt and Lighthouse PWA audit, and [SECURITY.md](SECURITY.md) with Private Vulnerability Reporting, respectively. See the exact wording in [Principles](docs/PRINCIPLES.md). ZIP features, the Service Worker and PWA support are not implemented yet; automated checks for the promises are planned for P5 CI.

Development requires Node.js 22 or newer: run `npm ci`, `npm run dev` and `npm run ci`. Self-hosting with Docker is planned for v0.4.0. License: [MIT](LICENSE).
