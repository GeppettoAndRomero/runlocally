# 原則

## 4 つの公約

**runlocally は、このアプリについて、利用者に対し以下を保証する：**

1. **クライアントからの追加送信なし**
   ツールページから外部サーバへのデータ送信を行わない。ツールへの入力データ（画像、テキスト、ファイル、設定値等）、ユーザー追跡 beacon、フィンガープリンティング等を一切含まない。CF Pages の HTTP アクセスログのように、ネットワーク運用上必然的に発生するものを除き、クライアントから追加のリクエストは飛ばない。DevTools の Network タブで検証可能。

2. **オフラインで動作する**
   Service Worker により、初回読み込み後はネットワーク切断時にも全機能が利用可能。DevTools の "Offline" モードで検証可能。

3. **PWA としてインストール可能**
   標準的な PWA 要件（manifest, icons, theme, HTTPS）を満たし、ブラウザのインストール導線を備える。Lighthouse PWA audit で検証可能。

4. **脆弱性報告経路を維持する**
   `SECURITY.md` に明記された経路（GitHub Private Vulnerability Reporting / `security@runlocally.app`）で脆弱性を受け付ける。受領 72 時間 / 初回応答 7 日の SLA を遵守する（§6.6）。

1 は DevTools の Network タブ、2 は DevTools の Offline モード、3 はブラウザのインストール導線と Lighthouse PWA audit、4 は `SECURITY.md` と GitHub Private Vulnerability Reporting で検証します。現時点では 2・3 および ZIP 機能は未実装です。公約の自動検証は P5 で CI に追加予定です。

## 運営と公開

運営は Geppetto 名義の匿名運営です。架空のユーザー、レビュー、利用者数を作らず、実在性を演出しません。AI 利用の開示は README の colophon のみです。リンク獲得を KPI にしません。

Cloudflare Web Analytics と NEL は採用しません。Web Analytics はエッジで JS beacon を挿入するため公約 1 に反します。

ロケールの追加には需要の証拠とネイティブレビュー体制が必要です。ロケール一覧は `src/i18n/locales.ts` の 1 箇所で管理します。
