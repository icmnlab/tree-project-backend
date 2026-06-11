# 交接文案：外接 GNSS + VLGEO2 現場 BLE 量測

> **Repo**：https://github.com/<GITHUB_OWNER>/tree-project-frontend  
> **詳細規格**：[`HANDOFF_EXTERNAL_GNSS_AND_BLE.md`](HANDOFF_EXTERNAL_GNSS_AND_BLE.md)  
> **儀器實測**：`test/vlgeo2_ble_analysis/docs/VLGEO2_GPS_SOLUTION.md`  
> **日期**：2026-05

---

## 一、專案在做什麼

在 **VLGEO2 維持 STD 逐棵 SEND（PHGF）** 的前提下，用 **外接 GNSS（LG290P + ESP32 BLE）** 提供 **優於儀器內建 GPS（~2.5 m）** 的座標，經 **手機 APP** 與每棵量測合併上傳。

```
[VLGEO2]  BLE PHGF ──────────→  APP（樹高 / 距離 / 方位）
[TreeGNSS] BLE NMEA(GGA/GSA) ─→  APP（3D fix、衛星數、HDOP、經緯度）
         手機同時維持兩路 BLE
```

**已證實（電腦/Mac 實測）**

| 通道 | PHGF | GPS |
|------|------|-----|
| BLE NUS，MEMORY 關，逐棵 SEND | ✅ | ❌ 0 句 GGA/RMC |
| USB DATA.CSV（MEMORY 開） | CSV 有 LAT/LON | ✅ |
| Classic `_COM`（Mac） | — | ❌ 0 byte |

→ 外掛 GNSS 走 **獨立 BLE → APP**，不依賴 Geo2 送 NMEA。

---

## 二、硬體定案（方案 1）

| 項目 | 選型 | Standalone 精度 |
|------|------|-----------------|
| GNSS | 微雪 **LG290P**（移远四频 RTK 模块） | **~0.7 m CEP**（优于 Geo2 2.5 m） |
| BLE 桥 | 微雪 **ESP32-C3-Zero-M（带排针）** | 广播名 **`TreeGNSS`** |
| 电源 | **既有** 5V 行动电源 / USB 线（不必另购） | ~220 mA，一场调查够用 |
| ML1220 纽扣电池 | **已购为标准版（未附）**；五金行可补 | 仅缩短断电后再定位等待，**不影响精度** |

**已下单（2026-05）**：LG290P ¥525.5（**不带 RTC 电池**）、ESP32-C3 ¥20.79——**请核对 ESP32 是否为带排针 -M**；贴片版需焊排针或补买 -M。  
**零焊接接线**：LG290P 附 SH1.0 线 → 母杜邦 → ESP32 RX(GPIO20) + GND。

**架设**：勿把大充电宝绑在 Geo2 握把。用 **1/4"-20 短杆 + 3D 打印盒** 固定 LG290P+ESP32，**天线垂直朝天**；Geo2 只管瞄准。

---

## 三、必购链接（仅 2 项）

| # | 品名 | 约价 | 链接 |
|---|------|------|------|
| 1 | **LG290P GNSS RTK Module**（含天线、SH1.0 线） | ¥500 | https://www.waveshare.net/shop/LG290P-GNSS-RTK-Module.htm |
| 2 | **ESP32-C3-Zero-M（带排针）** | ¥35–55 | https://www.waveshare.net/shop/ESP32-C3-Zero-M.htm |

**淘宝同源（合并下单）**：https://world.taobao.com/dianpu/442244005.htm  

**接线 / 桌测 Wiki**：https://www.waveshare.net/wiki/LG290P_GNSS_RTK_Module  

**勿买**：淘宝 ¥45「F9P」、无天线裸板、NEO-6M 级模块。

---

## 四、精度与稳定性

| 情境 | 预期 |
|------|------|
| 开阔地 standalone | **0.7–1.5 m** 级（datasheet 0.7 m CEP；优于 Geo2 **2.5 m**） |
| 林下 / 冠层 | 卫星数下降、误差变大（**所有 GNSS 共通**）；天线需朝上、尽量高于遮挡 |
| RTK cm 级 | 需 **NTRIP**（台湾 e-GNSS 等）；**非本次必买** |
| 冷/热启动 | 无 ML1220 时**完全断电**后再开可能多等 ~20–30 s；**不影响坐标精度**；调查中途保持供电即可 |
| BLE 稳定性 | ESP32 NUS 转发 NMEA 为业界常见做法；与 Geo2 使用 **相同 NUS UUID**，APP 已用 `flutter_blue_plus` |
| 耗电 | LG290P ~100 mA + ESP32 ~120 mA @ 5V；**不耗電** |

**到货验收（防假货）**

1. USB + QGNSS 读模块为 **LG290P**  
2. 开阔地 horizontal 明显 **< 2.5 m**  
3. nRF Connect 连 `TreeGNSS`，持续收到 `$GNGGA`

---

## 五、能否整合进 APP？（避免白花钱）

**可以。** 接口已对齐现有架构，无冷门协议。

| 整合点 | 现状 | 待做 |
|--------|------|------|
| BLE 协议 | Geo2 已用 NUS `6E400001-...` / notify `6E400003-...`（见 `ble_live_session_page.dart`） | TreeGNSS **同 UUID**，第二设备连接 |
| 量测触发 | `_onPacket` → `_processLiveMeasurement` | 不变 |
| GPS 注入 | `_resolveGpsForLiveMeasurement` 现弹 **手机 Geolocator** 对话框 | 改为读 `ExternalGnssService.latestFix` |
| 场设 | `FieldSessionSetup.gpsSource` 仅 `surveyor` \| `tree` | 加 **`external_gnss`** |
| NMEA 解析 | 验证脚本已有 GGA 逻辑 | 抽到 `external_gnss_service.dart` |
| ESP32 固件 | 无 | **UART 460800 读 LG290P → BLE NUS 送 NMEA**（单文件 Arduino 即可） |

**备选零硬件路线**（若老师不接受外掛）：MEMORY ON + BLE SEND FILES 解析 CSV GPS（`verify_vlgeo2_gps_usb_watch.py`），精度仍为 Geo2 内建 2.5 m。

**需与老师确认**：外接 survey GNSS 经 APP 入库是否合规（≠ 手机内建 GPS）。

**已知风险**

| 风险 | 缓解 |
|------|------|
| iOS 双 BLE | 先 Android 实机；iOS 需测双连接或改 workflow |
| 林下精度 | 接受 sub-meter 目标；要 cm 再加 NTRIP |
| 固件未写 | 硬件到货前先写 ESP32 桥 + 单元测试 NMEA parser |

---

## 六、程式待办（接手顺序）

1. **`firmware/treegnss_ble_nus/`**（或 repo 外）：ESP32 固件，设备名 `TreeGNSS`，460800 UART  
2. **`lib/services/external_gnss_service.dart`**：第二 BLE 连接、GGA/GSA 解析、`latestFix`  
3. **`field_session_setup.dart`**：加 `external_gnss` 选项  
4. **`ble_live_session_page.dart`**：`_resolveGpsForLiveMeasurement` 分支 + 卫星数 UI  
5. **与老师确认** GPS 合规与精度要求  

---

## 七、相关文件索引

| 路径 | 内容 |
|------|------|
| `docs/HANDOFF.md` | **交接總覽（跑起來、測試、部署）** |
| `docs/HANDOFF_EXTERNAL_GNSS_AND_BLE.md` | 采购、接线、UUID、验收、台湾 RTK |
| `test/vlgeo2_ble_analysis/docs/VLGEO2_GPS_SOLUTION.md` | 实测结论 |
| `test/vlgeo2_ble_analysis/docs/EXTERNAL_GNSS_ENGINEERING.md` | Geo2 §10 对照 |
| `lib/screens/ble_live_session_page.dart` | 现場 BLE 主流程 |
| `test/vlgeo2_ble_analysis/verify_vlgeo2_gps_ble.py` | 电脑端 GPS 验证 |

---

## 八、仪器与韌體

- 可装：`test/vlgeo2_ble_analysis/firmware_backup/installable/STD V39.VL7`  
- 勿装未购 license：BAF / Pile（见 `downloads/README_LICENSED.md`）
