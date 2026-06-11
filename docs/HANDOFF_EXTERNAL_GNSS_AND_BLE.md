# 交接：外接 GNSS + 現場 BLE 量測（2026-05）

> 給接手的開發者。  
> **交接總覽**：[`HANDOFF.md`](HANDOFF.md)  
> **精简交接文案**：[`HANDOFF_外接GNSS現場量測.md`](HANDOFF_外接GNSS現場量測.md)  
> 儀器實測結論見 `test/vlgeo2_ble_analysis/docs/`。

## 現狀（APP）

| 檔案 | 職責 |
|------|------|
| `lib/screens/ble_live_session_page.dart` | 現場連線：BLE 收 PHGF → 取 GPS → 建任務 → 開表單 |
| `lib/services/ble_live_packet_decoder.dart` | `$PHGF` 分片重組（**已修第二棵 §9.3 前綴 bug**） |
| `lib/utils/field_gps_capture.dart` | **目前 GPS 來源 = 手機 Geolocator**（多點取樣） |
| `lib/widgets/field/field_session_setup.dart` | `gpsSource`: `surveyor` \| `tree` |

### 收到 PHGF 後的流程

```
_onPacket → BleLiveNmeaAssembler.feed
         → _processLiveMeasurement
         → _resolveGpsForLiveMeasurement  ← 這裡要接外接 GNSS
         → createAndUploadFromBle → IntegratedTreeFormPage
```

### 下一步程式（外接 GNSS）

1. 新增 `lib/services/external_gnss_service.dart`（或 `instrument_gnss_cache.dart`）  
   - BLE 連外掛（NUS 或 SPP platform channel）  
   - 解析 `$GNGGA` / `$GNGSA` / `$GPGSV`  
   - 暴露：`fixType`（2D/3D）、`satellitesUsed`、`satellitesInView`、`hdop`、`latitude`、`longitude`、`accuracyM`  
   - UI：類似儀器「衛星數跳動」→ `Stream<GnssFixStatus>`

2. 擴充 `FieldSessionSetup.gpsSource`：  
   - `external_gnss` | `instrument_csv` | 保留 `surveyor`/`tree`

3. 改 `_resolveGpsForLiveMeasurement`：  
   - `external_gnss` → 讀 `ExternalGnssService.latestFix`（或量測前一步「定位」按鈕強制更新）  
   - metadata 寫入：`gps_source`, `fix_3d`, `sat_count`, `hdop`, `receiver_model`

4. 可選第二路線：`instrument_csv` = MEMORY ON + BLE SEND FILES，解析 `DATA.CSV` 最後一列（見 `verify_vlgeo2_gps_usb_watch.py`）

## 硬體（已下單 2026-05）

| 品项 | 状态 |
|------|------|
| LG290P GNSS RTK Module | 已买；**不带 RTC 电池**版（RTK/standalone 能力同电池版） |
| ESP32-C3 | 已买 ¥20.79；**待确认是否带排针 -M** |
| ML1220 | 未附；可选后补 |
| 5V 电源 / 线 | 自备 |

## 硬體架構

### 建議架構（量測與定位分步）

```
[VLGEO2] BLE PHGF ──────────────→ 手機 APP（樹高/距離/方位）
[外掛 GNSS] BLE NMEA/自訂 GATT ─→ 手機 APP（3D fix、衛星數、HDOP、座標）
```

- **不要**指望 Geo2 mini-USB **對外供電**：該孔為 **Device 口**（充電 + 接電腦傳檔），**不是 Host**，不能當外掛電源。  
- 外掛用 **自有行動電源（5V）**；見下方採購清單。  
- 機械：**1/4"-20 母牙**（手冊 monopod mount）→ 3D 列印支架 + 短螺柱；GNSS 天線朝上、少遮擋。

---

## VLGEO2 內建 GPS 是哪一種？（不是方案 1 也不是方案 2）

手冊 §10（見 `test/vlgeo2_ble_analysis/docs/EXTERNAL_GNSS_ENGINEERING.md`）：

| 項目 | **VLGEO2 內建** | 方案 2 LC29H(DA) | 方案 1 LG290P |
|------|-----------------|------------------|---------------|
| 芯片世代 | 儀器整合 **單頻** GNSS | 移远 **双频 L1+L5** RTK SoC | 移远 **四频 L1+L2+L5+E6** RTK SoC |
| 星座 | GPS / GLONASS / Galileo / QZSS + SBAS | 上列 + **北斗 B1/B2a** | 上列 + **北斗全频** + NavIC |
| **RTK** | **❌ 无** | ✅（需 NTRIP 才 cm） | ✅ |
| Standalone 精度 | **~2.5 m CEP**（SBAS） | **~1.0 m CEP** | **~0.7 m CEP** |
| 更新率 | **1 Hz** | 最高 10 Hz | 最高 20 Hz |
| 输出 | NMEA（Classic `_COM`；你们 Mac 实测 0 byte） | UART NMEA | UART NMEA |

**结论**：Geo2 是 **「旧式单频 multi-GNSS + SBAS、无 RTK」** 的仪器级 GPS，**技术类型上比方案 1、2 都旧**；精度上 **方案 1、2 的 standalone 规格都明确优于 Geo2**。  
硬要比「像谁」：比较接近 **没有 RTK 功能的入门外接 GPS**，**不像** 方案 1/2 这种现代双频/四频 RTK 模块。

### 方案 1 vs 方案 2 差别（为何推荐方案 1）

| | **方案 1 LG290P** | **方案 2 LC29H(DA)** |
|--|-------------------|----------------------|
| 精度（standalone） | **0.7 m**（更好） | 1.0 m（仍优于 Geo2） |
| 频段 | L1+L2+L5+**E6** 四频 | L1+L5 双频 |
| 体积 | 33×33 mm 小模块 | 65×30 mm HAT（不必买 Pi） |
| 台湾/亚洲 | 北斗 + SBAS 较完整 | 有北斗，频段较少 |
| 价格（微雪） | **约 ¥500** | **约 ¥350** |
| UART 默认波特率 | **460800** | **115200** |
| 套件 | Type-C + **含天线** + SH1.0 线 | Micro-USB + **含天线** |

**确定采用：方案 1**（精度最好、价差仅约 ¥150，仍远低于 Trimble 路线）。

---

## 採購清單（2026-05｜**方案 1 定案**｜僅信官方/旗艦店）

> **基准**：VLGEO2 ≈ **2.5 m CEP**。LG290P standalone **0.7 m CEP**。  
> **勿买**：¥45–90「F9P」、无品牌裸板。

### 必买（仅 2 项；线材 / 行动电源用既有即可）

| # | 品名 | 数量 | 参考价 | 购买链接 |
|---|------|------|--------|----------|
| 1 | **LG290P GNSS RTK Module**（含天线、SH1.0 线、排针） | 1 | **¥499.95** | https://www.waveshare.net/shop/LG290P-GNSS-RTK-Module.htm |
| 2 | **ESP32-C3-Zero-M**（带排针，烧 TreeGNSS 固件） | 1 | **约 ¥35–55** | https://www.waveshare.net/shop/ESP32-C3-Zero-M.htm |

**微雪淘宝同一货源**（可合并下单减运费）：https://world.taobao.com/dianpu/442244005.htm  

**接线 Wiki（LG290P ↔ ESP32）**：https://www.waveshare.net/wiki/LG290P_GNSS_RTK_Module

**自备**：任意 **5V ≥2A** 行动电源 + USB 线（LG290P Type-C、ESP32-C3 依板子接口）。合计约 **220 mA**，一场调查足够。

### 选配

| # | 品名 | 用途 |
|---|------|------|
| 3 | **ML1220 3V 纽扣电池** | LG290P JST 热启动；**五金行可买**，非必须 |
| 4 | 1/4"-20 公牙 + 3D 打印盒 | 固定于 Geo2 monopod 接口；天线垂直朝天 |

### 电源与信号（方案 1）

```
[既有 5V 行动电源]
   ├─ USB ──→ LG290P（~100 mA）
   └─ USB ──→ ESP32-C3-Zero（~120 mA）

LG290P TXD3（NMEA，460800）──→ ESP32 RX
GND 共地
```

**Geo2 不给外挂供电**；手机另连 VLGEO2 BLE + TreeGNSS BLE。

### 现场架设（勿绑大充电宝在握把）

- **推荐**：1/4"-20 短杆 + 3D 打印盒（LG290P + ESP32 + 小电池），天线**垂直朝天**；Geo2 只管瞄准。  
- **勿**：量树时让 GNSS 刚性随 Geo2 大幅倾斜（精度变差）。  
- 详见 [`HANDOFF_外接GNSS現場量測.md`](HANDOFF_外接GNSS現場量測.md) §二。

### 方案 2（更省约 ¥150）：仍优于 Geo2 — 约 **¥450 ≈ NT$2,000**

| # | 买什么 | 规格 | 链接 | 参考价 |
|---|--------|------|------|--------|
| 1 | **LC29H(DA) GPS/RTK HAT** | 移远 LC29H；**PVT ~1 m CEP**；RTK cm；**含 GPS External Antenna (D)** | [微雪 LC29H(DA)](https://www.waveshare.net/shop/LC29H-DA-GPS-RTK-HAT.htm) | 约 **¥349** |
| 2 | ESP32-C3-Zero | 同上 | 同上 | 约 **¥35–55** |
| 3–5 | 电源 + 线 + ML1220 | 同上 | — | 约 **¥100** |

**注意**：LC29H 为 40pin HAT 外形，**不必买树莓派**；5V + UART 跳线帽切到「外接 MCU UART」（见 LC29H Wiki），再接 ESP32。

### 方案 3（F9P 双频 L1+L2，林下略稳）— 约 **¥750–950 ≈ NT$3,400–4,300**

| # | 买什么 | 链接 | 参考价 |
|---|--------|------|--------|
| 1 | **ZED-F9P GPS-RTK HAT**（含多频天线） | [微雪 ZED-F9P HAT](https://www.waveshare.net/shop/ZED-F9P-GPS-RTK-HAT.htm) | 约 **¥900+**（官网变动） |
| 2 | ESP32-C3-Zero + 电源 | 同上 | 约 **¥150** |

**北天原厂（仅当微雪缺货）**：[北天旗舰店](https://www.taobao.com/list/dianpu/332390975.htm) · 型号 **BT-F9PK3**（含天线）；到货用 **u-center** 读芯片应为 u-blox ZED-F9P。

### 不要买的清单

| 商品 | 原因 |
|------|------|
| NEO-6M / ATGM336 / ¥45「F9P」 | 精度 **≤ 或差于** Geo2 2.5 m |
| 无天线裸 F9P 模块 | 无 L1/L2 天线则精度崩盘 |
| 无店铺评分 / 「其他品牌」超低价 F9P | 假芯片高发；见下方验收 |

---

## 外接电源（已纳入上表）

```
[5V 行动电源 双口]
   ├─ USB-C ──→ LG290P / LC29H（5V，<120 mA）
   └─ USB-C ──→ ESP32-C3-Zero（5V，~120 mA BLE 广播时）

[信号线] LG290P TXD3（NMEA）──→ ESP32 RX（如 GPIO4）
         GND ──────────────────→ ESP32 GND
（只读 NMEA 时可不接 GNSS RX）
```

- Geo2 **不能**给外挂供电；外挂与 Geo2 **分电**。  
- 现场：**手机** 同时 BLE 连 `VLGEO2_3190` + `TreeGNSS`（ESP32 广播名，见下）。  
- 天线用随板 **IPEX→SMA 短线** 接有源天线，**天线面朝天**，尽量高于冠层。

---

## APP 整合规格（与现有 VLGEO2 BLE 并存）

### 为何不会白花钱（整合保证）

| 依据 | 说明 |
|------|------|
| **标准 NMEA** | LG290P 输出 `$GNGGA` / `$GNGSA`；全球通用，非厂商私有 |
| **标准 BLE NUS** | 与 Geo2 相同 Service/Notify UUID（`ble_live_session_page.dart` L37–38） |
| **APP 已有 BLE 栈** | `flutter_blue_plus` 已连 Geo2；第二设备连 `TreeGNSS` 为同库扩展 |
| **明确接点** | `_resolveGpsForLiveMeasurement`（L399）现用 Geolocator → 改读 `ExternalGnssService` |
| **备选路线** | 若外掛不可用：MEMORY + CSV GPS（零硬件，精度 2.5 m） |
| **微雪官方 ESP32 范例** | LG290P Wiki 含 ESP32 UART 接线；固件仅多一层 BLE 转发 |

**剩余工作**：ESP32 固件 + `external_gnss_service.dart` + `gpsSource` 枚举（见 [`HANDOFF_外接GNSS現場量測.md`](HANDOFF_外接GNSS現場量測.md) §六）。

与 `ble_live_session_page.dart` 相同 **Nordic UART Service**，第二路 BLE 设备：

| 项目 | 值 |
|------|-----|
| 设备广播名 | `TreeGNSS`（勿与 Geo2 混淆） |
| Service UUID | `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` |
| Notify（手机收 NMEA） | `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` |
| 载荷 | ASCII NMEA 行，建议 **1–5 Hz**：`$GNGGA` / `$GNGSA` / `$GPGSV` 或 `$GNGSV` |
| UART 速率 | LG290P 默认 **460800**；LC29H **115200**；ESP32 须一致 |
| APP | `gpsSource: external_gnss` → `ExternalGnssService` 解析 → `_resolveGpsForLiveMeasurement` |

ESP32 固件：读 UART → 按行分包 BLE notify（可参考 [ArduSimple BLE Bridge](https://www.ardusimple.com/product/ble-bridge/) 思路；UUID 用上表即可对接 Flutter）。

---

## 到货验收（防假货）

1. **LG290P / LC29H**：电脑 USB 接板，[QGNSS](https://www.waveshare.net/wiki/LG290P_GNSS_RTK_Module) 或移远工具读模块型号。  
2. **ZED-F9P**：Windows **u-center** 读应为 **ZED-F9P**，非 NEO-M8N。  
3. **开阔地测试**：standalone 水平误差应 **明显 < 2.5 m**（通常 0.7–1.5 m）；若长期 > 5 m，检查天线与假模块。  
4. **BLE 测试**：手机 nRF Connect 连 `TreeGNSS`，notify 应持续出现 `$GNGGA`。

### 精度对照（datasheet，standalone PVT）

| 产品 | PVT CEP | vs Geo2 2.5 m |
|------|---------|-----------------|
| LG290P | **0.7 m** | ✅ 约好 3.5× |
| LC29H(DA) | **1.0 m** | ✅ 约好 2.5× |
| ZED-F9P | **1.5 m**（开阔常更好） | ✅ |
| VLGEO2 内建 | **2.5 m** | 基准 |

**cm 级**需另配 **NTRIP**（如台湾 e-GNSS **NT$300/日/组** + 注册）；硬件同上，非再买 Trimble。

### 台湾 GNSS / RTK 说明

| 模式 | 台湾可用 | 费用 | 说明 |
|------|----------|------|------|
| **Standalone PVT** | ✅ | 无 | 本项目现阶段；~0.7 m，优于 Geo2 |
| **RTK cm** | ✅ | e-GNSS 等付费 | 需 NTRIP + 手机网络 + 固件灌 RTCM；千寻（大陆）非台湾主方案 |
| **RTC 电池 ML1220** | ✅ 可后补 | 约几十台币 | 仅缩短断电后再定位等待，**不影响精度** |

- 国土地图 **e-GNSS**：https://egnss.nlsc.gov.tw/（法人注册 + 按日计费）  
- **冷启动**：断电久再开，无电池时可能多等 ~20–30 s 才有 fix，非手动改时间。

---

### 其他采购方向（非 DIY）

| 等級 | 產品例 | 精度 | 與 APP |
|------|--------|------|--------|
| 入門 multi-GNSS | Bad Elf Flex / Garmin GLO 2 | ~2–3 m | 手機 BT SPP 收 NMEA → 需 Android SPP 或原廠 SDK |
| 專業 sub-meter | **Trimble R1**、Juniper **Geode GNS3** | sub-m | BT NMEA；可選 **EXTERN.GPS 接 Geo2** 寫 CSV |
| 高精度 | Emlid Reach RS2+（RTK） | cm | 成本高；需 NTRIP/基站；APP 需接 Reach SDK 或 NMEA |
| 成品免焊 | **Columbus P-70 Ultra** | standalone ~30 cm | [GPSWebShop ~USD299](https://gpswebshop.com/products/columbus-p-70-ultra-precise-usb-and-bluetooth-gnss-receiver) · 内建 BT，免 ESP32 |

### 與環境學院

- 外接 **survey-grade** 接收機經 BLE 進 APP ≠ 手機內建 GPS，需老師確認是否接受。  
- **EXTERN.GPS → Geo2 CSV** 則座標在儀器檔內，另需 MEMORY + SEND FILES 同步。

## 儀器韌體（repo）

- 可安裝：`test/vlgeo2_ble_analysis/firmware_backup/installable/STD V39.VL7`  
- 勿裝未購 license：`BAF V14`、`Pile V25`（見 `downloads/README_LICENSED.md`）

## 驗證腳本

```bash
# Classic GPS（Mac 目前 0 byte，保留排查）
python test/vlgeo2_ble_analysis/verify_vlgeo2_classic_gps.py --diag

# MEMORY + USB 監看 CSV
python test/vlgeo2_ble_analysis/verify_vlgeo2_gps_usb_watch.py
```
