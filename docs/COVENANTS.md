# 公約の検証と実ブラウザ確認

この文書は [PRINCIPLES.md](PRINCIPLES.md) の4公約と、現在の検査が確認する範囲を対応付ける。公約の説明文は同文書から引用する。自動検証の対象は公開済みの操作と用意した fixture に限る。

## 公約の原文

1. **クライアントからの追加送信なし**
   ツールページから外部サーバへのデータ送信を行わない。ツールへの入力データ（画像、テキスト、ファイル、設定値等）、ユーザー追跡 beacon、フィンガープリンティング等を一切含まない。CF Pages の HTTP アクセスログのように、ネットワーク運用上必然的に発生するものを除き、クライアントから追加のリクエストは飛ばない。DevTools の Network タブで検証可能。

2. **オフラインで動作する**
   Service Worker により、初回読み込み後はネットワーク切断時にも全機能が利用可能。DevTools の "Offline" モードで検証可能。

3. **PWA としてインストール可能**
   標準的な PWA 要件（manifest, icons, theme, HTTPS）を満たし、ブラウザのインストール導線を備える。DevTools の Application → Manifest で検証可能。

4. **脆弱性報告経路を維持する**
   `SECURITY.md` に明記された経路（GitHub Private Vulnerability Reporting / `security@runlocally.app`）で脆弱性を受け付ける。受領 72 時間 / 初回応答 7 日の SLA を遵守する（§6.6）。

## 自動検証との対応

CI の `npm run ci` はビルド、静的な URL 検査、単体・部品テストを実行する。GitHub CI は別ステップで `CI=1 npm run test:e2e` を実行する。e2e のローカル配信は Wrangler Pages を使う。先に `npm run build` を実行する。Functions を含む e2e の配信に `astro preview` は使わない。設定は `playwright.config.ts` と `.github/workflows/ci.yml` を参照する。

| 対象 | 現物の検査・テスト名 | 場所と範囲 |
|---|---|---|
| 追加送信 | `tests/e2e/network.spec.ts`: `online operations and observed communication`; `chromium: offline repeats the same operations`; `chromium: monitor rejects page and service-worker probes` | CI と、承認後の本番 smoke。オンライン操作と観測可能な通信は Chromium・Firefox・WebKit。SW 発通信、オフライン、監視器 probe は Chromium。 |
| CSP・配信時注入 | `tests/e2e/csp.spec.ts`: `published operations have no policy violations or reporting injection`; `detector sees browser rejection: inline script`; `detector sees browser rejection: blob script`; `detector sees browser rejection: blob worker`; `detector sees browser rejection: external fetch` | CI と、承認後の本番 smoke。オンラインと検知器は3ブラウザ、オフライン操作は Chromium。SW を介さない応答で CSP、NEL／Report-To／Reporting-Endpoints 不在と既知の beacon パターンを検査。 |
| 静的 URL | `scripts/check-egress.mjs`; `tests/unit/egress-allowlist.test.ts`: `accepts only scoped public URLs and exact namespace literals`; `tests/unit/egress-scan.test.ts`: `rejects an empty dist and catches minified JS URLs` | `npm run ci` のビルド成果物にある HTML・JS の URL リテラル。動的通信や配信時注入とは検査対象が異なる。 |
| オフライン・URL | `tests/e2e/covenants.spec.ts`: `session URLs and offline operations`; `tests/e2e/network.spec.ts`: `chromium: offline repeats the same operations` | CI と、承認後の本番 smoke。URL・履歴・言語切替は3ブラウザ。公開ページ巡回と操作のオフライン再現は Chromium。事前保存と SW 制御開始を待ってから検査する。 |
| manifest・登録・公開ページ・報告経路 | `tests/e2e/covenants.spec.ts`: `published pages, manifest and reporting path` | CI と、承認後の本番 smoke。3ブラウザで manifest、icons、theme、公開ページ、root SW、配信された SECURITY.md とフッターのリンクを検査。CDP による installability は Chromium。 |
| 外枠・ページ同期 | `tests/e2e/chrome.spec.ts`: 外枠の初期表示、操作・言語・履歴・入力形式による同期、File と結果の保持、アイコンと precache | CI の3ブラウザ。外枠の hover・focus・SPA 遷移後の追加リクエストを検査する。全操作時の通信と SW 発通信は `network.spec.ts` が検査する。 |
| precache | `tests/unit/pwa-build.test.ts`: `contains one root worker and manifest with all public pages and matched vendor assets`; `tests/unit/pwa-manifest.test.ts`: `uses every public URL and keeps each HTML revision`; `rejects absent pages, duplicates and an incomplete vendor pair` | CI のビルドと単体検査。公開ページと資産の構成を確認する。 |
| 旧 SW 移行 | `tests/e2e/sw-migration.spec.ts`: `chromium removes old registrations and caches while retaining current operations`; `tests/unit/register-sw.test.ts`: `removes prior scope and cache before registering once` | `tests/fixtures/sw/legacy.ts` の旧 8 スコープを使用。移行 e2e は ZIP 直接訪問と日本語・英語ハブ経由を CI の Chromium で確認する。人工的な登録・キャッシュによる検査で、本番 smoke の選択対象には含めない。 |
| 更新・ビルド識別 | `tests/unit/register-sw.test.ts`: `holds an update when another tab does not answer`; `pauses input while applying and defers reload if work starts before controller change`; `reloads once after a safe controller change`; `tests/unit/build-meta-build.test.ts`: `keeps the worker, page revisions, assets and headers stable for a SHA-only change`; `tests/unit/check-deployed-build.test.ts`: `accepts one exact head meta with varied attribute syntax` | CI の単体検査。端末の更新操作は実機で補う。 |

`tests/e2e/_helpers.ts` の一巡は ZIP の閲覧・取り出し・削除・名前修復、7z の閲覧・取り出し、保存・再入力、入れ子 ZIP を含む。`tests/e2e/_covenant-support.ts` は公開操作に対応する fixture の欠落を失敗にする。通信監視は初回読み込み前に開始し、precache、操作、保存・再入力を観測する。失敗した許可外リクエストも失敗条件になる。公開ページは完全一致、資産は限定した接頭辞で許可する。CSP に遮断されて通信イベントにならない試行は CSP 検査で補う。静的 URL 検査の例外は通信先の許可を意味しない。

自動検証は、実インストール完了、報告への応答 SLA、全 CDN 拠点、既存端末のキャッシュ更新完了を検証しない。SECURITY 経路の検査は配信文書とリンクまでであり、報告送信、メール配送、Private Vulnerability Reporting の受付動作を確認しない。配信時の注入は CI 内のビルド検査だけでは確認できない。本番 smoke が配信応答の確認経路だが、実配信と初回実行は承認後であり、現時点では未実施。

`astro.config.mjs` の build meta は SW 生成後、`scripts/gen-headers.mjs` のヘッダ生成前に、`scripts/build-meta.mjs` が全公開 HTML へ挿入する。SHA だけの変更では precache revision は変わらず、ページ内容の変更では更新を検知する。既存端末の DOM に残る SHA は現在の配信 SHA の判定に使わない。

`.github/workflows/deploy.yml` は手動起動で `dry_run` が既定で有効。成功した main CI の SHA を照合し、その SHA を checkout して再ビルド・検査し、`dist` と Functions を組で封印・検証する。承認後の本番 smoke は `tests/e2e/covenants.spec.ts`、`tests/e2e/network.spec.ts`、`tests/e2e/csp.spec.ts` を選択実行し、前後に `scripts/check-deployed-build.mjs` で apex の SHA を調べる。この検査は SW を介さない HTTP 応答を読み、meta の欠落・複数・不一致とリダイレクトを拒否する。実配信、配信先の対応、保護設定、通知先はこの文書の検査結果として扱わない。

## 手動確認

実インストールと端末固有の動作は、検証用の安全な配信環境で実ブラウザを操作して確かめる。本番反映は別途承認後に行う。

1. **準備:** 同じ origin とブラウザプロファイルを使う。ブラウザ・OS・版、対象 SHA、開始時の SW 登録・キャッシュを記録する。用いる fixture は `tests/fixtures` と `tests/e2e/_covenant-support.ts` を参照する。
2. **インストール:** manifest とブラウザの診断を確認し、ページまたはブラウザの導線からインストールする。起動後の表示、単独ウィンドウでの起動、再起動後の操作を確認する。導線がない環境は理由と未確認項目を記録する。
3. **オフライン:** 事前保存と SW 制御開始を確認後、ネットワークを切断する。公開ページの再読込・遷移、ZIP の閲覧・取り出し・削除・名前修復、7z の閲覧・取り出し、保存・再入力、入れ子 ZIP を fixture で確認する。終了後にオンラインへ戻す。
4. **更新:** ローカル検証用の内容が異なる2ビルドを同じ origin で切り替える。SHA だけの変更を更新発生条件にしない。待機中の SW を確認し、別タブあり・処理中・File 保持中・結果ありで更新が保留されることを確認する。保存だけでは解除されないため、Reset と別タブ終了後に適用する。作業中のタブを強制再読込して代替しない。
5. **旧 SW 移行:** 実際の旧登録を持つ検証用プロファイルではサイトデータを消さずに移行前後を比較する。再現用登録なら実端末の旧状態と区別する。root 以外の登録と非 Workbox キャッシュの除去、root SW の動作、旧 SW URL の 410・転送なし、移行後の操作を確認する。検証用 SW を本番へ配置しない。
6. **記録:** 実施日時、環境、origin、対象 SHA、SW を介さない HTTP 取得で観測した SHA、fixture、操作、期待結果・実結果、成功／失敗／未確認、SW・キャッシュの前後、必要な画面とログを非公開の記録へ残す。旧 DOM の SHA だけで配信や更新の成功を判定しない。
