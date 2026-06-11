# 修正紀錄上傳（選用）

## 兩種「訓練資料」

| 機制 | 用途 | 預設 |
|------|------|------|
| **研究資料蒐集**（管理後台） | 捲尺周長 + 距離 + 照片，DBH 校準用乾淨資料集 | 管理員主動使用 |
| **修正紀錄上傳**（`MLDataCollector`） | 使用者改寫自動 DBH／樹種／碳儲量時的背景紀錄 | **關閉** |

## 何時啟用修正紀錄

僅在需要從**大量現場覆寫**回推模型誤差時：

```bash
flutter run --dart-define=ENABLE_ML_CORRECTION_UPLOAD=true
```

啟用後：V3 服務頁（`v3_services_page.dart`）會出現「修正紀錄上傳」卡片，並每 30 分鐘嘗試上傳至後端 `POST /api/ml-training/batch`（`routes/ml_training_data.js`）。

## 建議

- 一般調查／碳匯作業：**不必開啟**，減少背景流量與隱私顧慮。
- 論文 DBH 實驗：優先使用 **研究資料蒐集**，不要用修正紀錄取代。
