# 建置與發布指南

> **零硬編碼原則**：所有環境值（後端位址、地圖金鑰、功能旗標）都在建置／執行時注入，不寫死在原始碼。
> 未提供 `--dart-define=API_BASE_URL` 時 App 連不到後端；未提供 Google Maps 金鑰時地圖頁空白。詳見 `lib/config/app_config.dart` 與 `HANDOFF_SECRETS_CHECKLIST.md`。

**當前版本**：`18.10.0+22`

---

## 0. 前置需求

- Flutter SDK（與 CI 一致的 3.x；以 `flutter --version` 確認）、`flutter doctor` 全綠
- Android：JDK 17 + Android SDK；iOS：macOS + Xcode
- **Google Maps API Key**（地圖／邊界繪製／維護地圖必需，見 §3）
- Release 簽名 keystore（見 §5）

---

## 1. 開發執行（`flutter run`）

```powershell
cd frontend
flutter devices                      # 先確認裝置 id
flutter run -d <device-id> --dart-define=API_BASE_URL=https://<你的主機>/api
```

自簽憑證主機（如 Tailscale `*.ts.net` 或區網 IP）需加入信任，否則 TLS 驗證失敗：

```powershell
flutter run -d <device-id> `
  --dart-define=API_BASE_URL=https://<你的主機>/api `
  --dart-define=SELF_SIGNED_TRUSTED_HOSTS=.ts.net,100.x.x.x
```

現場實機（release + adb logcat 量測日誌）：

```powershell
flutter run -d <device-id> --release `
  --dart-define=API_BASE_URL=https://<你的主機>/api `
  --dart-define=SELF_SIGNED_TRUSTED_HOSTS=.ts.net `
  --dart-define=ENABLE_FIELD_LOGS=true
```

### `--dart-define` 旗標一覽（來源：`lib/config/app_config.dart`、`lib/main.dart`）

| 旗標 | 必填 | 預設 | 說明 |
|------|:---:|------|------|
| `API_BASE_URL` | ✅ | （空） | 後端 API base，例如 `https://host/api` |
| `SELF_SIGNED_TRUSTED_HOSTS` | 視情況 | （空） | 信任自簽憑證主機；逗號分隔，可用 `.ts.net` 後綴信任整個 tailnet。預設一律走正規 TLS |
| `TREE_ML_SERVICE_URL` | 否 | （空） | ML 服務 URL（亦可由後端動態下發） |
| `ENABLE_FIELD_LOGS` | 否 | `false` | 現場量測 adb logcat |
| `ENABLE_ML_CORRECTION_UPLOAD` | 否 | `false` | 上傳使用者覆寫修正紀錄（研究用） |
| `ENABLE_EXPERIMENTAL_UI` | 否 | `false` | 首頁實驗入口（AI 助理、掃描 Demo、V3 設定等） |

---

## 2. Android APK 建置

```powershell
cd frontend
flutter build apk --release --build-name=18.10.0 --build-number=22 `
  --dart-define=API_BASE_URL=https://<你的主機>/api
# 輸出: build\app\outputs\flutter-apk\app-release.apk
```

> 縮小體積可加 `--split-per-abi`（產生各 ABI 分檔）。地圖金鑰由 `key.properties` 自動注入（見 §3），不需放進 `--dart-define`。

### iOS（Mac）

```bash
cd frontend
flutter build ios --release --build-name=18.10.0 --build-number=22 \
  --dart-define=API_BASE_URL=https://<你的主機>/api
# 然後使用 Xcode Archive 發布
```

---

## 3. Google Maps API Key（地圖頁必需）★

App 以 `google_maps_flutter` 顯示地圖（地圖頁、邊界繪製、維護地圖）。**必須提供你自己的金鑰**，否則地圖空白或灰底。

1. **Google Cloud Console** → 啟用 **Maps SDK for Android**（iOS 另啟 **Maps SDK for iOS**）。
2. 建立 **API Key**，並加上**應用程式限制**以免被盜用計費：
   - Android：套件名 `com.sustainable.treeai` + 簽名 **SHA-1**
   - 取得 SHA-1：`keytool -list -v -keystore <keystore.jks> -alias <alias>`
3. 寫入 `frontend/android/key.properties`（已 `.gitignore`，範本見 `android/key.properties.example`）：
   ```properties
   GOOGLE_MAPS_API_KEY=AIza...你的金鑰...
   ```
   - CI 可改用 project property：`flutter build apk -PGOOGLE_MAPS_API_KEY=AIza...`
4. **注入機制（已設定，無需改動）**：
   `android/app/build.gradle.kts` 讀 `key.properties` → `manifestPlaceholders["GOOGLE_MAPS_API_KEY"]` → `AndroidManifest.xml` 的 `com.google.android.geo.API_KEY`。
5. **iOS**：`ios/Runner/Info.plist` 使用建置變數 `$(GOOGLE_MAPS_API_KEY_IOS)`；於 Xcode build settings／xcconfig 設定該值（並確認 `GMSServices.provideAPIKey` 已在 `AppDelegate` 載入金鑰）。

> ⚠️ 金鑰務必加平台／套件／SHA-1 限制；切勿 commit 進 git。

---

## 4. key.properties 完整範例（簽名 + 地圖金鑰）

```properties
storePassword=<YOUR_KEYSTORE_PASSWORD>
keyPassword=<YOUR_KEY_PASSWORD>
keyAlias=tree_app_upload_xu.6
storeFile=keystore/upload-keystore-new.jks
GOOGLE_MAPS_API_KEY=AIza...你的金鑰...
```

> ⚠️ 不要將實際密碼／金鑰寫入任何 commit；以安全管道（1Password、環境變數、CI secrets）傳遞。

---

## 5. Android 簽名設定

### 5.1 Keystore 位置（建議結構）
```
project_code/frontend/android/
├── app/keystore/upload-keystore-new.jks   # 不要 commit
└── key.properties                          # 不要 commit
```

### 5.2 .gitignore 確認
```gitignore
android/key.properties
android/keystore/
*.jks
*.keystore
```

### 5.3 驗證
```powershell
cd frontend
flutter build apk --release --dart-define=API_BASE_URL=https://<你的主機>/api
```

---

## 6. iOS 簽名設定

- **Bundle ID（iOS）**：`com.sustainable.sustainableTreeai`（Android applicationId 為 `com.sustainable.treeai`）
- 開發：Xcode → Runner Target → Signing & Capabilities → 勾選 *Automatically manage signing* → 選 Team
- 發布：Apple Developer Portal 建立 Provisioning Profile → Xcode 選用 → Product → Archive → Distribute App

---

## 7. CI/CD 建議（GitHub Actions 範例）

```yaml
name: Build Release
on:
  push:
    tags: ['v*']
jobs:
  build-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with: { flutter-version: '3.x' }
      - name: Decode Keystore
        run: echo "${{ secrets.KEYSTORE_BASE64 }}" | base64 -d > android/app/keystore/upload-keystore-new.jks
      - name: Create key.properties
        run: |
          echo "storePassword=${{ secrets.KEYSTORE_PASSWORD }}" >> android/key.properties
          echo "keyPassword=${{ secrets.KEY_PASSWORD }}" >> android/key.properties
          echo "keyAlias=${{ secrets.KEY_ALIAS }}" >> android/key.properties
          echo "storeFile=keystore/upload-keystore-new.jks" >> android/key.properties
          echo "GOOGLE_MAPS_API_KEY=${{ secrets.GOOGLE_MAPS_API_KEY }}" >> android/key.properties
      - name: Build APK
        run: flutter build apk --release --dart-define=API_BASE_URL=${{ secrets.API_BASE_URL }}
      - uses: actions/upload-artifact@v4
        with:
          name: app-release.apk
          path: build/app/outputs/flutter-apk/app-release.apk
```

---

## 8. 版本號規範（語意化版本 `MAJOR.MINOR.PATCH+BUILD`）

| 區段 | 何時遞增 |
|------|---------|
| `MAJOR`（如 18→19） | 重大變更／UI 全面重設計 |
| `MINOR`（如 .9→.10） | 新功能、向後相容 |
| `PATCH`（如 .0→.1） | bug 修正、小調整 |
| `+BUILD`（如 +22） | 每次發布遞增；Android versionCode、iOS build number |

`pubspec.yaml` 必須與發布版本同步：

```yaml
version: 18.10.0+22
```

---

## 9. 問題排除

**地圖空白／灰底** → `key.properties` 缺 `GOOGLE_MAPS_API_KEY`，或金鑰未啟用 *Maps SDK for Android*，或 SHA-1／套件名限制不符（見 §3）。

**App 連不到後端／一直轉圈** → 未帶 `--dart-define=API_BASE_URL`，或自簽憑證主機未加入 `SELF_SIGNED_TRUSTED_HOSTS`。

**`Keystore file not found`** → 確認 keystore 路徑、`key.properties` 用相對路徑（`keystore/xxx.jks`）。

**`Key password is incorrect`** → 確認密碼無多餘空白／換行。

**iOS `No signing certificate`** → 確認 Apple Developer 帳號、Keychain 憑證、重新下載 Provisioning Profile。
