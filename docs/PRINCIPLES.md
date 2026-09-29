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

1 は DevTools の Network タブ、2 は DevTools の Offline モード、3 はブラウザのインストール導線と Lighthouse PWA audit、4 は `SECURITY.md` と GitHub Private Vulnerability Reporting で検証します。内部エンジンには ZIP の一覧・抽出・再構築・作成・分割・結合・修復と、RAR／7z／tar／tar.gz の一覧・展開があります。画面では ZIP の閲覧・取り出し・削除・名前修復、RAR／7z／tar の閲覧・取り出しが使えます。現時点では 2・3 は未実装です。公約の自動検証は P5 で CI に追加予定です。公開 API は [ENGINE.md](ENGINE.md) を参照してください。

The internal engine implements ZIP listing, extraction, rewriting, creation, splitting, merging and recovery, plus listing and extraction for RAR, 7z, tar and tar.gz. The screen supports ZIP browsing, extraction, removal, and name repair, plus browsing and extraction for RAR, 7z, and tar. Offline Service Worker support and PWA installation are not implemented yet. Automated verification of the four promises is planned for P5 CI. See [ENGINE.md](ENGINE.md) for the current API.

## 運営と公開

運営は Geppetto 名義の匿名運営です。架空のユーザー、レビュー、利用者数を作らず、実在性を演出しません。AI 利用の開示は README の colophon のみです。リンク獲得を KPI にしません。

Cloudflare Web Analytics と NEL は採用しません。Web Analytics はエッジで JS beacon を挿入するため公約 1 に反します。

ロケールの追加には需要の証拠とネイティブレビュー体制が必要です。`src/i18n/locales.ts` の code・default・hreflang 一覧を唯一の供給元とし、既定値と英語参照、Astro の設定をそこから導出します。操作ごとのページは、画面でその操作を利用できる場合に限り公開します。
