# Factor Analysis — what drives DBH error?


## Factor: Depth model (model_key)

| Level | # configs | mean MAE (cm) | median MAE | mean MAPE % | mean RMSE | mean ≤20% | mean t/img (s) |
|---|---:|---:|---:|---:|---:|---:|---:|
| depth_pro | 4 | 12.45 | 9.86 | 29.24 | 16.22 | 45.0 | 11.33 |
| sanity_check | 1 | 41.98 | 41.98 | 78.40 | 52.31 | 0.0 | 11.28 |
| da_v2_large | 4 | 49.99 | 31.65 | 140.54 | 51.09 | 25.0 | 14.05 |
| da_v2_base | 4 | 50.10 | 35.39 | 138.50 | 52.28 | 25.0 | 3.96 |
| da_v2_small | 4 | 71.52 | 67.04 | 174.98 | 92.45 | 30.0 | 2.10 |

**Spread (worst − best mean MAE): 59.06 cm** — larger ⇒ this factor matters more.


## Factor: Segmentation mode (mask_mode)

| Level | # configs | mean MAE (cm) | median MAE | mean MAPE % | mean RMSE | mean ≤20% | mean t/img (s) |
|---|---:|---:|---:|---:|---:|---:|---:|
| nomask | 8 | 41.78 | 23.13 | 103.27 | 54.32 | 5.0 | 9.18 |
| ? | 1 | 41.98 | 41.98 | 78.40 | 52.31 | 0.0 | 11.28 |
| gtmask | 8 | 50.25 | 5.52 | 138.36 | 51.70 | 57.5 | 6.54 |

**Spread (worst − best mean MAE): 8.47 cm** — larger ⇒ this factor matters more.


## Factor: Distance source (dist_mode)

| Level | # configs | mean MAE (cm) | median MAE | mean MAPE % | mean RMSE | mean ≤20% | mean t/img (s) |
|---|---:|---:|---:|---:|---:|---:|---:|
| refdist | 8 | 9.65 | 8.61 | 24.96 | 10.84 | 52.5 | 6.47 |
| ? | 1 | 41.98 | 41.98 | 78.40 | 52.31 | 0.0 | 11.28 |
| nodist | 8 | 82.38 | 88.27 | 216.67 | 95.18 | 10.0 | 9.25 |

**Spread (worst − best mean MAE): 72.73 cm** — larger ⇒ this factor matters more.


## Extremes

- **Best**:  `da_v2_small__gtmask__refdist` → MAE 3.26 cm, MAPE 7.2%, ≤20% 100%
- **Worst**: `da_v2_small__nomask__nodist` → MAE 148.73 cm, MAPE 321.3%, ≤20% 0%