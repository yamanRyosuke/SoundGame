# 一筆書きレーン型 音楽ゲーム 仕様書（Claude-Code 用）

## 1. 目的
本仕様書は、**Three.js + Vite を用いた Web 音楽ゲーム**の初期実装を、
Claude-Code によるコード生成で進めるための共通理解資料である。

本ゲームは以下を特徴とする：
- Blender で作成した **一筆書き Curve レーン**上を、黄色い三角形（プレイヤーカーソル）が等速移動
- 音楽再生時刻と同期し、ノーツ通過タイミングで **指定キー入力（W/A/S/D）**を行うことで得点
- **固定譜面 / 自動生成譜面**、**複数判定難易度**を切り替えて検証可能な構造

---

## 2. 技術スタック
- 描画：Three.js
- ビルド：Vite
- 音声：Web Audio API（AudioContext + AudioBufferSourceNode）
- データ：JSON
- レーン作成：Blender（Curve）

---

## 3. Blender 側仕様（レーン）

### 3.1 レーン形状
- レーンは **Curve オブジェクト（中心線）**で作成する
- 分岐なしの一筆書き
- 自己交差は許可（Z 座標で手前・奥を表現）

### 3.2 サンプルレーン
以下の 3 種類を Blender 上に事前生成する：
- 円（Circle）
- 三角形（Triangle）
- 四角形（Square）

※ サンプル生成は Blender Python スクリプトで行う（別途用意済み）

### 3.3 書き出し仕様（重要）
- Curve を **等間隔サンプリング**し、点列として JSON に書き出す
- 書き出し対象：選択中の Curve 1 本

#### 出力 JSON 例
```json
{
  "laneId": "lane_circle",
  "points": [[x,y,z], [x,y,z], ...]
}
```

- サンプリング間隔：実装側で指定可能（例：0.05〜0.1 Blender Unit）
- 曲線長は Web 側で計算してもよい

---

## 4. ゲーム進行モデル

### 4.1 基本概念
- 黄色い三角形（カーソル）は、レーン全長 L を **曲の再生時間 T に合わせて等速移動**する

```
進捗率 p = audioTime / T
移動距離 d = L * p
```

- audioTime は Web Audio API の現在時刻を唯一の基準とする

---

## 5. 譜面（Chart）仕様

### 5.1 共通フォーマット
固定譜面・自動生成譜面は **同一 JSON 構造**を使用する

```json
{
  "audio": {
    "src": "song01.ogg",
    "duration": 142.53
  },
  "laneId": "lane_circle",
  "notes": [
    { "t": 12.345, "type": "tap", "key": "W" },
    { "t": 12.900, "type": "tap", "key": "A" },
    { "t": 30.000, "type": "hold", "key": "D", "t2": 31.200 },
    { "t": 40.000, "type": "chord", "keys": ["W","D"] }
  ]
}
```

### 5.2 ノーツ種別
初期実装：
- tap（単押し：W/A/S/D）

拡張予定（データ構造は先行対応）：
- hold（長押し）
- chord（同時押し）
- roll / repeat（連打）

---

## 6. 判定システム

### 6.1 判定基準
- 判定は `abs(audioTime - note.t)` の差分（ms）で行う

### 6.2 判定プリセット（切替可能）

```ts
type JudgementPreset = {
  name: string;
  windowsMs: {
    perfect: number;
    great?: number;
    good?: number;
    miss: number;
  };
};
```

#### 用意する例
- Loose：80 / 140 / 200 ms
- Normal：40 / 80 / 120 ms
- Hard：25 / 50 / 80 ms

---

## 7. 自動譜面生成（検証用）

### 7.1 方針
- 固定譜面を基本としつつ、**自動生成譜面と比較検証可能**な構造にする

### 7.2 実装優先度
1. ダミー自動生成（等間隔 or BPM ベース）
2. Node.js で音源を解析し、オンセット検出で JSON を生成

### 7.3 インターフェース

```ts
interface ChartProvider {
  getChart(audioMeta, lane): Promise<Chart>;
}
```

- FixedChartProvider
- AutoChartProvider

---

## 8. 初期スコープ（MVP）

- レーン：1 本（Blender から JSON）
- 楽曲：1 曲
- ノーツ：Tap のみ
- 判定：3 プリセット切替
- 譜面：Fixed / Auto 切替

---

## 9. ゴール
- ブラウザ上でプレイ可能
- 音同期・等速移動・判定が安定している
- 設定切替により設計検証が高速に行える

---

（以上）
