# 原則

## 4 つの公約

**runlocally は、このアプリについて、利用者に対し以下を保証する：**

1. **クライアントからの追加送信なし**
   ツールページから外部サーバへのデータ送信を行わない。ツールへの入力データ（画像、テキスト、ファイル、設定値等）、ユーザー追跡 beacon、フィンガープリンティング等を一切含まない。CF Pages の HTTP アクセスログのように、ネットワーク運用上必然的に発生するものを除き、クライアントから追加のリクエストは飛ばない。DevTools の Network タブで検証可能。

2. **オフラインで動作する**
   Service Worker により、初回読み込み後はネットワーク切断時にも全機能が利用可能。DevTools の "Offline" モードで検証可能。

3. **PWA としてインストール可能**
   標準的な PWA 要件（manifest, icons, theme, HTTPS）を満たし、ブラウザのインストール導線を備える。DevTools の Application → Manifest で検証可能。

4. **脆弱性報告経路を維持する**
   `SECURITY.md` に明記された経路（GitHub Private Vulnerability Reporting / `security@runlocally.app`）で脆弱性を受け付ける。受領 72 時間 / 初回応答 7 日の SLA を遵守する（§6.6）。

1 は DevTools の Network タブ、2 は DevTools の Offline モード、3 はブラウザのインストール導線と DevTools の Application → Manifest、4 は `SECURITY.md` と GitHub Private Vulnerability Reporting で検証します。内部エンジンには ZIP の一覧・抽出・再構築・作成・分割・結合・修復と、RAR／7z／tar／tar.gz の一覧・展開があります。画面では ZIP の閲覧・取り出し・削除・名前修復、RAR／7z／tar の閲覧・取り出しが使えます。初回の事前保存完了後、Service Worker は公開中の10ページと操作資産をオフラインで提供します。対応ブラウザではインストール案内を表示します。実際のオフライン操作とインストールは実機確認が必要です。公約全体の自動検証は P5 で CI に追加予定です。公開 API は [ENGINE.md](ENGINE.md) を参照してください。

The internal engine implements ZIP listing, extraction, rewriting, creation, splitting, merging and recovery, plus listing and extraction for RAR, 7z, tar and tar.gz. The screen supports ZIP browsing, extraction, removal, and name repair, plus browsing and extraction for RAR, 7z, and tar. After initial precaching completes, the Service Worker serves the ten public pages and operation assets offline. Supported browsers can show an install prompt. Offline operations and installation still need device verification. Automated verification of the four promises is planned for P5 CI. See [ENGINE.md](ENGINE.md) for the current API.

## 運営と公開

匿名で運営します。架空のユーザー、レビュー、利用者数を作らず、実在性を演出しません。支援を受けたコードに関する開示は README の colophon と各ページの共通フッターに置きます。リンク獲得を KPI にしません。

Cloudflare Web Analytics と NEL は採用しません。Web Analytics はエッジで JS beacon を挿入するため公約 1 に反します。

ロケールの追加には需要の証拠とネイティブレビュー体制が必要です。追加手順と辞書・公開 URL の検証は [I18N.md](I18N.md) に記載します。`src/i18n/locales.ts` の code・default・hreflang 一覧を唯一の供給元とし、既定値と英語参照、Astro の設定をそこから導出します。操作ごとのページは、画面でその操作を利用できる場合に限り公開します。
