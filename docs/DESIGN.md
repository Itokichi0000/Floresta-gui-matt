# Floresta Web UI 設計書（Claude Code向け）

> 原本: 「Floresta Web UI 設計書（Claude Code向け）」2026-11-18 版を Markdown に書き起こしたもの。
> 実装はこのファイルのステップ（第10章）に沿って進める。

## 1. 概要・目的

自分のMacや自宅サーバーで動く [Floresta](https://github.com/getfloresta/Floresta)（florestad）を、ブラウザから操作・観察できるWeb UIを、オープンソースで作る。完成したら、Florestaの開発者Davidson Souza氏に見てもらう。

- **誰のためか**：Florestaを自分で動かす人。コマンドラインに不慣れな人と、勉強会で仕組みを見せたい人。
- **解決したいこと**：今は `floresta-cli` で結果を読むしかない。同期が止まった原因（例：Utreexo対応ピアが0台）にも気づきにくい。
- **ゴール**：同期状況、ピア、Utreexoの森、監視ウォレット、ブロックを、一つの画面群で扱えるようにする。
- **名前（仮）**：`floresta-ui`。本家との関係が決まるまでの仮称（未決事項参照）。

この設計書は、Claude Codeがそのまま実装に入れる粒度で書く。デザインと未決事項は、相談しながら埋めていく。

## 2. 参考：Davidsonのfloresta-webui

[floresta-webui](https://github.com/Davidson-Souza/floresta-webui) は、2024年12月の5コミットで止まっている初期段階のプロジェクト。目標と機能リストは受け継ぎ、動かなくなっている部分を作り直す。

### 受け継ぐもの（READMEの目標）

- シンプル、依存が少なく、壊れにくい
- Florestaの機能のほとんどを、良いUXで見せる
- 動かしやすい（ノードを別の機器で動かす「ノード・イン・ア・ボックス」型も想定）

### READMEの機能リスト（すべて未完成）と、本プロジェクトでの扱い

| floresta-webuiの予定機能 | 本プロジェクト |
|---|---|
| ノードの統計（稼働時間、リソース、最良チェーン、ピア数） | MVP：ダッシュボード |
| ディスクリプタ・xpubの登録 | MVP：ウォレット画面 |
| 自分の取引の閲覧 | 後続（ウォレットの取引一覧をどう取るか要調査） |
| 特定アドレスのスキャン | 後続 |
| 簡易ブロックエクスプローラー | MVP：ブロック画面 |
| assume-utreexoの値をQRコードで書き出す | 後続（森の画面に追加） |

### 作り直すもの（現状のコードの問題）

- **構成**：素のHTML/CSS/JS（3ファイル）＋Pythonの静的ファイルサーバー。DockerでFloresta 0.6.0と一緒に動かす想定。
- **認証がない**：ブラウザから `http://localhost:8332` へ直接RPCを送っている。今のFlorestaは初期設定で `.cookie` 認証が必須なので、401で弾かれる。
- **古い応答形式**：`getblockchaininfo` の `best_block`、`height`、`ibd` といった古いフィールド名を読んでいる。今は `bestblockhash`、`blocks`、`initialblockdownload` というCore互換の名前に変わっている。
- **画面**：「Blockchain Info」と「Node Info（ピア数のみ）」の2枚のカード、5秒ごとの自動更新、ディスクリプタ登録のモーダル、ライト／ダーク切り替え。この構成自体は参考にする。

本プロジェクトは、この目標をそのまま実現する「一つの実装」として位置づける。本家へのPRにするか、別リポジトリとして紹介するかは未決（未決事項参照）。

## 3. スコープ

MVPは「読む」機能を中心に5画面。ノードの状態を変える操作は、ピア追加とディスクリプタ登録の2つだけに絞る。

| フェーズ | 機能 | 使うRPC |
|---|---|---|
| MVP | ダッシュボード（同期進捗、高さ、稼働時間、メモリ、ピア数） | getblockchaininfo, uptime, getmemoryinfo, getconnectioncount, getnetworkinfo |
| MVP | ピア一覧（Utreexo対応を強調、「対応ピア不足」の警告）とピア追加 | getpeerinfo, addnode, disconnectnode |
| MVP | 森（Utreexoアキュムレータの根と木の構成を可視化） | getroots, getblockchaininfo |
| MVP | ウォレット（ディスクリプタの登録と一覧、再スキャン） | loaddescriptor, listdescriptors, rescanblockchain |
| MVP | ブロック（高さ・ハッシュで検索、ヘッダーと取引一覧） | getblockhash, getblockheader, getblock |
| 後続 | assume-utreexoの値をQRで書き出し | getroots, getblockchaininfo |
| 後続 | 自分の取引の閲覧、アドレスのスキャン | 要調査（Electrum経由か、新RPCが必要か） |
| 後続 | 署名済み取引の送信 | sendrawtransaction |
| 後続 | デーモン停止、ログ閲覧 | stop（ログはdebug.logを中継サーバーが読む） |

**やらないこと**：秘密鍵を扱うこと（Florestaのウォレットは監視専用）。florestadの起動やインストールの代行。インターネットへの公開。

## 4. アーキテクチャ

ブラウザからflorestadを直接呼ばず、同じマシンで動く小さな中継サーバー（`serve.py`）を挟む。ブラウザは `.cookie` ファイルを読めず、CORSにも阻まれるため。認証情報をブラウザに渡さず、呼べるRPCを制限する目的もある。

```
ブラウザ（静的なHTML・CSS・JS）
  同じオリジンの /api/rpc にだけリクエストを送る。パスワードやcookieを一切持たない
        │ HTTP POST /api/rpc（メソッド名と引数だけ）
        ▼
中継サーバー serve.py（127.0.0.1:3000）  ◀── 読む ── ~/.floresta/.cookie
  許可リストにあるRPCメソッドだけを通す            （florestad起動ごとに値が変わる。
  Basic認証ヘッダーを付けてflorestadへ転送          401が返ったら読み直す）
  画面のファイル配信も兼ねる
        │ JSON-RPC＋Basic認証（127.0.0.1:8332）
        ▼
florestad
  ブロック検証、Utreexoの森、監視専用ウォレット。ブロック本体は保存しない
        │ P2P 8333（ブロックとUtreexo証明を受け取る）
        ▼
ビットコインネットワーク
  Utreexo対応ピア（ブリッジ・アーカイブ）と通常ノード
```

中継サーバーだけがcookieを読み、florestadへのRPCを代行する。ブラウザが知るのはメソッド名と引数だけ。

### 4.1 中継API（`POST /api/rpc`）

- リクエスト：`{"method": "getblockchaininfo", "params": []}`。`jsonrpc` と `id` はサーバー側で付ける。
- レスポンス：florestadの `result` と `error` をそのまま返す。
- florestadに繋がらない：502で `{"error": "node_unreachable"}`。画面は「ノードに接続できません」を表示し、取得を続ける。
- 許可リスト外のメソッド：403で `{"error": "method_not_allowed"}`。
- タイムアウト：通常10秒、`getblock` と `rescanblockchain` は30秒。

| 区分 | メソッド | 初期設定 |
|---|---|---|
| 読み取り | getblockchaininfo, getbestblockhash, getblockcount, getblockhash, getblockheader, getblock, getpeerinfo, getconnectioncount, getnetworkinfo, getmemoryinfo, getroots, uptime, listdescriptors, getrpcinfo, getaddrmaninfo, getdeploymentinfo | 許可 |
| 状態を変える | addnode, disconnectnode, loaddescriptor, rescanblockchain | 許可（画面で確認ダイアログ） |
| 危険 | stop, sendrawtransaction | 拒否。`--allow-dangerous` を付けたときだけ許可 |

### 4.2 設定

環境変数と起動引数で指定する。変数名 `FLORESTAD_URL` はfloresta-webuiのdocker-compose.ymlに合わせる。

| 変数 | 既定値 | 意味 |
|---|---|---|
| FLORESTAD_URL | http://127.0.0.1:8332 | florestadのRPCの場所 |
| FLORESTA_DATADIR | ~/.floresta | cookieを探すデータディレクトリ |
| FLORESTA_NETWORK | bitcoin | signet、testnet4、regtestならcookieのパスとポートを切り替える |
| FLORESTA_RPC_USER / FLORESTA_RPC_PASSWORD | なし | 指定するとcookieの代わりに使う |
| UI_BIND | 127.0.0.1:3000 | UIを待ち受ける場所 |

### 4.3 セキュリティ

- 待ち受けは初期設定で `127.0.0.1` のみ。LANに公開するには `UI_BIND=0.0.0.0:3000` を明示し、起動時に警告を出す。LAN公開時のログイン機能は後続フェーズ。
- cookieの中身をログ、エラーメッセージ、レスポンスに一切出さない。
- 他サイトからの不正リクエスト対策：`Content-Type: application/json` 以外は拒否する。`Origin` と `Host` ヘッダーが自分自身でなければ拒否する（DNSリバインディング対策を兼ねる）。
- 秘密鍵は扱わない。ウォレット画面は `xprv`、`tprv` を含む入力を送信前に止める。

## 5. 画面設計

左にサイドバー（5画面の切り替え）、上に常時表示のステータスバー（ネットワーク名、高さ、接続状態）を置く。各画面はURLの `#/` 以降で切り替え、リロードしても同じ画面に戻る。

### 5.1 ダッシュボード（`#/`）

- 同期進捗バー：`verificationprogress`（0〜1）。`initialblockdownload` がtrueの間は「同期中」バッジ。
- 数字タイル：検証済み高さ `blocks`／ヘッダー高さ `headers`、稼働時間（`uptime`、秒→「3日4時間」）、ピア数（うちUtreexo対応数）、メモリ使用量（`getmemoryinfo` の `locked.used`）、ディスク使用量（`size_on_disk`）。
- 最新ブロック：`bestblockhash` とブロック時刻（`time`、「12分前」形式）。クリックでブロック画面へ。
- 警告バナー：Utreexo対応ピアが2未満、または高さが10分以上変わらないときに「同期が止まっている可能性」を出し、ピア画面へ誘導する。Florestaは対応ピアが2台未満だと同期を進めないため。
- 更新：5秒ごとに自動取得（floresta-webuiと同じ）。タブが非表示の間は止める。

### 5.2 ピア（`#/peers`）

- 表：アドレス、user_agent、サービス（`servicesnames` をチップ表示）、接続種別 `kind`、状態 `state`、V1/V2、接続時の高さ。
- Utreexo判定：`services`（16桁hex）を数値にして `1<<12`（UTREEXO）と `1<<13`（アーカイブ）を見る。該当行を強調表示し、上部に「Utreexo対応 2台／全体 8台」。
- 操作：「ピアを追加」フォーム（`addnode <ip:port> add`）、行ごとの「切断」（`disconnectnode`、確認ダイアログ付き）。

### 5.3 森（`#/forest`）

- 目的：Utreexoを知らない人に「このノードはUTXOセットの代わりにこれだけを持っている」と見せる、このUIの看板画面。
- 表示：`getroots` の根を木の列として並べ、各根のハッシュをコピー可能にする。「根の合計サイズ」（根の数×32バイト）と、通常のUTXOセット（約数GB）の比較を一文で添える。
- 制約：葉の数（leaves）を返すRPCがない。そのため各木の大きさは正確には描けず、MVPでは根の数だけを使う（未決事項参照）。
- 後続：根と高さとブロックハッシュをQRコードで書き出し、別のFlorestaの初期設定に使えるようにする。

### 5.4 ウォレット（`#/wallet`）

- 登録済みディスクリプタの一覧（`listdescriptors`）。長い文字列は中略表示＋コピーボタン。
- 「追加」フォーム：ディスクリプタを貼り付けて `loaddescriptor`。「監視専用です。xpubやディスクリプタだけを入れてください」と明記し、`xprv` を含む入力は送信前に拒否する。
- 「過去を再スキャン」：開始高さまたは日付を指定して `rescanblockchain`。日付指定時は `use_timestamp` と `confidence`（high／medium／low／exact）を選ばせる。内部ではBIP 158ブロックフィルターを使う。

### 5.5 ブロック（`#/block/<高さかハッシュ>`）

- 検索欄：数字なら `getblockhash` でハッシュに変換してから取得。
- ヘッダー：`getblockheader` で即座に表示（ローカルにあるため速い）。
- 中身：`getblock`（verbosity 1）でサイズ、weight、取引ID一覧。Florestaはブロックを保存しないので、この呼び出しはネットワークから取り寄せる。「ピアから取得中」と表示し、失敗したらヘッダーだけ残す。
- 前後のブロックへの移動ボタン。

## 6. RPCの注意点（Floresta固有の挙動）

FlorestaのRPCはBitcoin Coreと同じ名前・形式に寄せているが、ブロックもUTXOも持たないため意味が違う値がある。UIは次の前提で作る。仕様は [FlorestaのRPCドキュメント](https://github.com/getfloresta/Floresta/tree/master/doc/rpc)（master、2026年11月時点）による。

| RPC | 注意点 | UIでの扱い |
|---|---|---|
| getblockchaininfo | `pruned` は常にtrue、`pruneheight` は常に `blocks + 1` | この2つは表示しない |
| getblock | ブロックを保存しないため、毎回ネットワークから取得。遅い・失敗しうる | 読み込み表示、タイムアウト30秒 |
| getrawtransaction, gettxout | 登録したウォレットに関係する取引しか返さない | 任意の取引検索は作らない |
| getpeerinfo | `inbound`、`relaytxes` は常にfalse。`services` は16桁のhex文字列 | 不要な列は出さない。ビットはBigIntで判定 |
| getmemoryinfo | macOSとLinux(glibc)以外では0が返る | 0なら「取得不可」と表示 |
| getroots | 根のhex配列のみ。葉の数は返さない | 森画面の制約（5.3） |
| sendrawtransaction | メモリプールは自分の取引しか持たない | 後続フェーズ |

**認証**：初期設定は `.cookie` 認証。ファイルの中身は `__cookie__:<64桁hex>` の1行で、そのままHTTP Basic認証の `user:pass` になる。florestadを再起動するたびに値が変わる。場所はメインネットが `~/.floresta/.cookie`、その他は `~/.floresta/<signet|testnet4|regtest>/.cookie`。`--rpc-user`／`--rpc-password` で固定パスワードにもできる（[認証ドキュメント](https://github.com/getfloresta/Floresta/blob/master/doc/rpc/auth.md)）。

**ポート**：メインネット8332、Signet 38332、Testnet4 48332、Regtest 18442。

## 7. 技術スタック

推奨は案A（Python標準ライブラリの中継サーバー＋ビルド不要の素のJS）。floresta-webuiの構成をそのまま伸ばす形になり、「依存が少ない」という目標に最も合う。最終決定は未決事項。

| 案 | サーバー | フロント | 良い点 | 弱い点 |
|---|---|---|---|---|
| A（推奨） | Python 3標準ライブラリのみ（`http.server`） | 素のHTML＋ES Modules、ビルドなし | pip不要。Davidsonの構成と地続き。Claude Codeも理解しやすい | 画面が増えるとJSの整理が必要 |
| B | Rust（axum）、静的ファイルをバイナリに同梱 | Aと同じ | 単一バイナリで配布できる。Florestaと同じ言語 | ビルドに時間がかかる。依存クレートが増える |
| C | Node.js（Honoなど） | Vite＋ReactまたはSvelte | 部品が豊富で見た目を作りやすい | npm依存が数百個になり、目標と矛盾する |

**使う無料素材（案Aの場合）**。CDNは使わず `static/vendor/` に同梱する。ノードの利用状況を外部に漏らさず、オフラインのノード機器でも動くようにするため。

| 用途 | 候補 | ライセンス |
|---|---|---|
| CSSの土台 | Pico CSS | MIT |
| アイコン | Lucide（必要なSVGだけコピー） | ISC |
| グラフ（高さの推移など） | uPlot | MIT |
| QRコード（後続） | qrcode-generator | MIT |
| フォント | Inter、JetBrains Mono（ハッシュ表示用） | OFL |

ブラウザの対応は、最新版のChrome、Safari、Firefox。スマホ幅（375px）でも崩れないこと。

## 8. デザイン方針

**決定：緑をメインにした、日本のアニメ・RPG風デザイン（E案「Anime RPG」）。** Florestaは「森」の意味。森の女の子とbittyくんがノードの状態を教えてくれる、日本人が作ったと一目で分かる見た目にする。モックアップは方向性の参考であり、最終的な絵や画面はClaude Codeがこの章に沿って作る。

### Claude Codeへのデザイン指示

- **トップ画面の構成**：上半分に「森のステージ」。空、丘、Utreexoの木（根の数だけ並べる）、左に女の子、右にbittyくん。下にノベルゲーム風の会話ウィンドウ（名札、セリフ、選択肢ボタン）。その下にSTATUSとPARTYの2つのウィンドウ。
- **会話で状態を伝える**：女の子がノードの状態を話し、選択肢で該当画面へ移動する。例：同期停止時「The forest stopped growing... Shall we check on the party?」→「▶ Check party」。bittyくんは吹き出しでひと言だけ、不機嫌なツッコミ役（「Hmph. No proofs again.」）。
- **表情の切り替え**：同期中＝やる気、最新に追いついた＝笑顔、同期停止・Utreexoピア2台未満＝心配、ノードに繋がらない＝寝ている。各キャラ4種類。
- **RPG風の言い換え（表示名のみ。URLや内部名は第5章のまま）**：高さ＝「Lv.」、同期進捗＝「SYNC EXP」バー＋「NEXT → 残りブロック数」、ピア＝「PARTY」、ピア追加＝「Invite a friend」、森画面＝「Forest Map」。各表示には本来の用語（height、peers、addnode）をツールチップで添え、開発者が迷わないようにする。
- **キャラクター**：
  - 森の女の子：オリジナル。緑のボブ、双葉のアホ毛、花の髪飾り、緑のパーカー。既存キャラクターに似せないこと（緑髪ツインテールは避ける）。名前は未定。
  - bittyくん：SpiralのHere Comes Bitcoin（素材は「Anyone can use them anywhere without our permission」と明記、Spiralの案内）のキャラクター。公式に「No Copyright」。公式素材を使い、`static/assets/characters/` に置き、READMEに出典を書く。素材を取得できないときは仮の絵で進め、人間に差し替えを頼む。
  - 絵はSVGで描く（拡大しても粗くならず、表情をパーツで差し替えられるため）。アニメはゆったりした呼吸やまばたき程度にし、`prefers-reduced-motion` で止める。
- **色**：背景 #EAF7E3（若葉色、薄いドット柄）、線と文字 #24442F（深緑）、メイン #5CBF6A、会話ウィンドウ #1F4D30＋白文字、ボタン・名札 #FFD66B、もう一つの差し色にピンク #FFD1DC、bittyくんのオレンジ #F7931A。ダークモードは「夜の森」（紺がかった深緑の背景、星と蛍）。
- **形**：太い深緑の枠線（2.5〜3px）、角丸14〜26px、真下にずらした影（`0 5px 0`）。ウィンドウの見出しは枠の上に乗せたタブ。グラデーションとぼかし影は使わない。
- **文字**：M PLUS Rounded 1c（丸ゴシック、OFL）を `static/vendor/` に同梱。ハッシュとアドレスはJetBrains Mono。
- **言語**：英語が標準、右上のEN／日本語ボタンで切り替え。見出しには英語でも小さくカタカナを添える（STATUS ステータス、PARTY パーティ）。
- **最初にやること**：トップ画面の見た目を1枚作り、スクリーンショットを見せて人間の確認を取ってから他の画面に展開する。

以下は最初に検討した3案（A 森、B ターミナル、C クリーン）の記録。その後、D案（緑×かわいい）を経てE案に決めた。

| 案 | 雰囲気 | 向いている場面 |
|---|---|---|
| A 森（Florestaブランド） | 深い緑と生成りの色。木や根のモチーフでUtreexoの「森」をそのまま見せる | 本家に見せる・取り込んでもらう前提なら最有力 |
| B ターミナル | 黒地に等幅フォント、緑やオレンジの文字。サイファーパンク風 | 開発者や勉強会でのデモ。強い個性 |
| C クリーン | 白地（ダーク切り替えあり）のカード型ダッシュボード。mempool.spaceやノード管理アプリに近い | 初心者が迷わない。他のノードUIと並んでも自然 |

どの案でも守ること：ライト／ダーク両対応（floresta-webuiにもある）。ハッシュと数字は等幅フォント。色だけに意味を持たせず、「Utreexo」などの文字も添える。文字と背景のコントラストはWCAG AA（4.5:1）以上。UIの文言は英語を標準にし、日本語を切り替えで用意する（未決事項参照）。

## 9. リポジトリ構成・OSS運用

ライセンスは本家に合わせてMIT。案Aの場合の構成は次のとおり。

```
floresta-ui/
├── server/
│   ├── serve.py          # 静的ファイル配信＋/api/rpc中継（標準ライブラリのみ）
│   ├── config.py         # 環境変数と引数の読み込み
│   └── test_serve.py     # unittest（偽のflorestadを立てて試す）
├── static/
│   ├── index.html
│   ├── css/              # デザイントークンと画面別CSS
│   ├── js/
│   │   ├── rpc.js        # /api/rpcを呼ぶ共通関数
│   │   ├── router.js     # #/ の画面切り替え
│   │   ├── format.js     # 秒→「3日」、バイト→「GB」など
│   │   └── views/        # dashboard.js, peers.js, forest.js, wallet.js, block.js
│   ├── i18n/             # en.json, ja.json
│   └── vendor/           # Pico CSS, uPlot など（ライセンス文付き）
├── docs/
│   └── screenshots/
├── Dockerfile
├── docker-compose.yml    # florestad＋UIを一緒に起動
├── README.md             # 英語。スクリーンショット、動かし方、本家との関係
├── README.ja.md
├── CONTRIBUTING.md
├── LICENSE               # MIT
└── .github/workflows/ci.yml   # PythonテストとHTMLの構文チェック
```

**READMEに書くこと**：一行で何か（「A small, low-dependency web UI for Floresta」）、スクリーンショット、`python3 server/serve.py` だけで動く手順、floresta-webuiの目標を受け継いだことの明記とリンク、対応するFlorestaのバージョン。

**コミットの作法**：1機能1コミット。英語の命令形（例：`Add peers view with utreexo highlight`）。Davidsonが履歴を読んで追えるようにする。

## 10. Claude Codeへの実装ステップと受け入れ条件

この設計書をMarkdownで書き出し、リポジトリの `docs/DESIGN.md` として置く。Claude Codeには「`docs/DESIGN.md` を読んで、ステップ1から順に実装して。各ステップの終わりで受け入れ条件を確かめ、コミットして止まって」と依頼する。

1. **土台**：リポジトリ構成、LICENSE、READMEの骨組み、`serve.py` の静的配信。
   - 受け入れ：`python3 server/serve.py` で `http://127.0.0.1:3000` に空のレイアウト（サイドバー＋ステータスバー）が出る。
2. **RPC中継**：`POST /api/rpc`、cookie読み込み、許可リスト、エラーの整形。第4章の通り。
   - 受け入れ：`curl -X POST localhost:3000/api/rpc -d '{"method":"getblockcount"}'` で高さが返る。許可外の `stop` は403。florestad停止時は `{"error":"node_unreachable"}`。テストが通る。
3. **ダッシュボード**（5.1）。
   - 受け入れ：高さ・進捗・稼働時間・ピア数が5秒ごとに更新される。florestadを止めると「ノードに接続できません」表示に切り替わり、再起動で自動復帰する。
4. **ピア**（5.2）。
   - 受け入れ：Utreexo対応ピアが強調され、件数が `floresta-cli getpeerinfo` と一致する。ピア追加後、数秒で一覧に現れる。
5. **ブロック**（5.5）。
   - 受け入れ：高さ0（genesis）と最新の高さでヘッダーが表示される。`getblock` が失敗してもヘッダーは残る。
6. **ウォレット**（5.4）。
   - 受け入れ：signetまたはregtestでディスクリプタを登録すると一覧に出る。`xprv` を含む入力は送信されず警告が出る。
7. **森**（5.3）。選んだデザイン案の見せ場。
   - 受け入れ：根の数が `floresta-cli getroots` の配列長と一致し、各根をコピーできる。
8. **仕上げ**：日本語切り替え、ダークモード、Docker、スクリーンショット付きREADME。
   - 受け入れ：`docker compose up` でflorestadとUIが両方起動し、画面が表示される。

**開発中の確かめ方**：メインネットの同期は時間がかかり、現在のMacでは同期が止まっている。そのため画面の確認は `florestad --network signet` か、RPC応答を返す偽サーバー（`server/mock_florestad.py`、応答例はdoc/rpcから作る）で行う。偽サーバーをステップ2で一緒に作らせる。

## 11. 未決事項（相談して決めること）

- [ ] デザイン：E案（女の子×bittyくんのRPG風）に決定。残りは女の子の名前（第8章）
- [ ] 技術スタック：案A（Python＋素のJS）で仮決定。作りながら見直す（第7章）
- [ ] 本家との関係：自分のリポジトリで作って紹介するか、floresta-webuiへのPRを目指すか。先にDavidsonに軽く声をかけるか
- [ ] リポジトリ名：`floresta-ui`、`floresta-dashboard`、その他
- [ ] UIの言語：英語標準＋日本語切り替えで良いか
- [ ] 森画面の葉の数：RPCがないので、根の数だけで描くか、`getroots` に葉の数を足す提案をFloresta本体に出すか
- [ ] Florestaのバージョン：masterのみ対応か、リリース版にも合わせるか
