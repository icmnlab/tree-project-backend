# 建置與發布指南

## 快速開始

### Android APK (Windows)
```powershell
cd frontend
flutter build apk --release --build-name=15.0.0 --build-number=1
# 輸出: build\app\outputs\flutter-apk\app-release.apk
```

### iOS (Mac)
```bash
cd frontend
flutter build ios --release --build-name=15.0.0 --build-number=1
# 然後使用 Xcode Archive 進行發布
```

---

## 版本號規範

| 版本 | 說明 |
|------|------|
| `16.x.x` | 主版本，對應大功能更新（如 UI 重設計） |
| `x.0.x` | 次版本，對應功能完善 |
| `x.x.0` | 修補版本，對應 bug fix |

**當前版本**: `16.0.2` (已發布) - UI 重設計、樹種辨識完善
**上一版本**: `15.0.0`

---

## Android 簽名設定

### 1. Keystore 位置

**建議結構**:
```
project_code/
├── frontend/
│   ├── android/
│   │   ├── app/
│   │   │   └── keystore/           # keystore 存放目錄 (不要 commit)
│   │   │       └── upload-keystore-new.jks
│   │   └── key.properties          # 簽名設定 (不要 commit)
```

### 2. key.properties 設定

**目前使用** (`key.properties`):
```properties
storePassword=<YOUR_KEYSTORE_PASSWORD>
keyPassword=<YOUR_KEY_PASSWORD>
keyAlias=tree_app_upload_xu.6
storeFile=keystore/upload-keystore-new.jks
```

> ⚠️ **安全提醒**: 不要將實際密碼寫入任何文件或 commit 到 Git！
> 密碼應該透過安全管道（如 1Password、環境變數）傳遞。

### 3. 遷移步驟

1. 建立 keystore 目錄:
   ```powershell
   # Windows
   mkdir android\keystore
   copy <KEYSTORE_PATH>\upload-keystore.jks android\keystore\
   ```
   
   ```bash
   # Mac (如果 keystore 在其他位置)
   mkdir -p android/keystore
   cp /path/to/upload-keystore.jks android/keystore/
   ```

2. 更新 `key.properties`:
   ```properties
   storeFile=keystore/upload-keystore.jks
   ```

3. 確認 `.gitignore` 排除:
   ```gitignore
   # 簽名檔案
   android/key.properties
   android/keystore/
   *.jks
   *.keystore
   ```

### 4. 驗證設定

```powershell
# Windows
cd frontend
flutter build apk --release
```

---

## iOS 簽名設定

### 1. Bundle ID
- **正式**: `com.sustainable.sustainableTreeai`

### 2. 簽名方式

iOS 簽名必須在 Mac 上完成，有兩種方式：

#### 方式 A: Xcode 自動簽名 (開發用)
1. 開啟 `ios/Runner.xcworkspace`
2. 選擇 Runner Target → Signing & Capabilities
3. 勾選 "Automatically manage signing"
4. 選擇 Team (Apple Developer Account)

#### 方式 B: 手動簽名 (發布用)
1. 在 Apple Developer Portal 建立 Provisioning Profile
2. 下載並安裝
3. 在 Xcode 中選擇對應的 Profile

### 3. 建置與發布

```bash
# 1. 建置
cd frontend
flutter build ios --release

# 2. Archive (Xcode)
# 開啟 Xcode → Product → Archive

# 3. 上傳至 App Store Connect
# 使用 Organizer → Distribute App
```

---

## CI/CD 建議 (未來)

如果需要自動化建置，可以考慮：

### GitHub Actions 範例

```yaml
# .github/workflows/build.yml
name: Build Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.x'
      
      - name: Decode Keystore
        run: echo "${{ secrets.KEYSTORE_BASE64 }}" | base64 -d > android/keystore/upload-keystore.jks
      
      - name: Create key.properties
        run: |
          echo "storePassword=${{ secrets.KEYSTORE_PASSWORD }}" >> android/key.properties
          echo "keyPassword=${{ secrets.KEY_PASSWORD }}" >> android/key.properties
          echo "keyAlias=${{ secrets.KEY_ALIAS }}" >> android/key.properties
          echo "storeFile=keystore/upload-keystore.jks" >> android/key.properties
      
      - name: Build APK
        run: flutter build apk --release
      
      - name: Upload APK
        uses: actions/upload-artifact@v3
        with:
          name: app-release.apk
          path: build/app/outputs/flutter-apk/app-release.apk
```

---

## 問題排除

### Android 建置失敗

**問題**: `Keystore file not found`
```
Execution failed for task ':app:validateSigningRelease'.
> Keystore file '...' not found for signing config 'release'.
```

**解決**:
1. 確認 keystore 檔案存在
2. 確認 `key.properties` 路徑正確
3. 使用相對路徑而非絕對路徑

---

**問題**: `Key password is incorrect`

**解決**:
1. 確認密碼正確
2. 檢查是否有多餘空白或換行

---

### iOS 建置失敗

**問題**: `No signing certificate`

**解決**:
1. 確認 Apple Developer 帳號有效
2. 在 Keychain Access 中確認憑證存在
3. 嘗試重新下載 Provisioning Profile

---

## 同步 pubspec.yaml 版本

```yaml
# pubspec.yaml 應該與發布版本同步
version: 14.3.1+1
```

**注意**: `+1` 是 build number，每次發布都應該遞增
