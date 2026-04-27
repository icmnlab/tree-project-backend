const express = require('express');
const router = express.Router();
const { resolveCountyByLngLat } = require('../utils/geo');

// 縣市判斷統一委派 utils/geo.js (內政部 1140318 官方界線; 詳見 utils/geo.js + data/tw_county.geojson)。
// V2 流程歷史上回傳的是「去掉市/縣後綴」的縣市名 (例: 台南 / 嘉義), 直接帶進「專案區位」輸入框,
// 為避免破壞行為相容性, 此處仍保留 strip 後綴, 僅換掉底層資料來源。
function getCountyShortName(lat, lng) {
    const r = resolveCountyByLngLat(lng, lat);
    if (!r || !r.name) return null;
    return r.name.replace(/(市|縣)$/, '');
}

// 驗證位置是否在指定區位的合理範圍內
router.post('/validate', (req, res) => {
    const { area, latitude, longitude } = req.body;

    // 基本座標範圍驗證（台灣範圍）
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng) || lat < 21.5 || lat > 26.5 || lng < 119 || lng > 123) {
        return res.json({ success: true, isValid: false, message: '座標超出台灣範圍' });
    }

    const suggestedArea = getCountyShortName(lat, lng);
    if (area && suggestedArea && suggestedArea !== area) {
        return res.json({
            success: true,
            isValid: false,
            message: `座標位於「${suggestedArea}」，與指定區位「${area}」不符`,
            suggestedArea
        });
    }

    res.json({ success: true, isValid: true, message: '位置驗證通過' });
});

// 建議合理的區位
router.post('/suggest_area', (req, res) => {
    const { latitude, longitude } = req.body;
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const suggestedArea = getCountyShortName(lat, lng);
    if (suggestedArea) {
        res.json({ success: true, suggestedArea });
    } else {
        res.json({ success: false, message: '無法判斷建議區位' });
    }
});

module.exports = router;
