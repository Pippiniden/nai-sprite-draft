# nai-sprite-draft

NovelAI V4.5 で立ち絵の表情差分をまとめて生成・選別するためのブラウザツールです。
ビルド不要の静的ページなので、GitHub Pages でそのまま動きます。

## 使い方

- GitHub Pages で公開したページを開き、ヘッダーの「APIキー」に NovelAI の Persistent API Token（`pst-...`）を設定します。
- 詳しい操作はページ内の「使い方」を参照してください。

データ（プロジェクト・生成画像・APIキー・テンプレート）はすべて閲覧しているブラウザの中（IndexedDB / localStorage）に保存され、サーバーには送られません。
保存先はドメインごとに分かれるため、別の URL で開いた版（`file://` で開いた旧版など）のデータは見えません。移すときはバックアップ／復元を使ってください。

## ローカルで動かす

ES Modules を使っているため、HTML ファイルをダブルクリックで開くと動きません。リポジトリ直下で静的サーバーを立ててください。

```
python -m http.server 8123
```

ブラウザで http://localhost:8123/ を開きます。

## 構成

```
index.html          画面の骨組みとヘルプ
css/style.css
js/
  main.js           起動処理（各モジュールを読み込み、プロジェクトを開く）
  util.js           $ / uid / esc などの小物
  ui.js             トースト・確認モーダル・APIキー/ヘルプのモーダル
  state.js          state、プロジェクトの生成と保存、旧データの補完
  db.js             IndexedDB
  api.js            送信ペイロードの組み立てと API 呼び出し
  queue.js          生成キュー、未エンコードのバイブス確認
  keepalive.js      バックグラウンド維持・完了通知
  zip.js            ZIP の読み書き
  images.js         採用・保留・削除
  refs.js           バイブス・精密参照・img2img
  expressions.js    表情カード、選択、フィルター、セットの読み書き
  variants.js       バリエーション・無効化・送信プロンプトの確認
  library.js        表情テンプレート
  lightbox.js       拡大表示
  thumbmenu.js      サムネイルの右クリックメニュー
  settings.js       左パネルの設定
  project.js        プロジェクト・キャラクター管理、バックアップ/復元
  bulk.js           プロンプト一括編集
  export.js         ZIP 書き出し・一括削除
```

各モジュールは読み込まれた時点で自分のボタンにイベントを登録します。モジュールのトップレベルでは関数と定数の宣言、イベント登録だけを行い、他モジュールの値を読む処理は関数の中に置いてください（循環 import でも安全に動かすため）。
