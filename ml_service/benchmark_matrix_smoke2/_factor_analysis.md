# Factor Analysis — what drives DBH error?


## Factor: Depth model (model_key)

| Level | # configs | mean MAE (cm) | median MAE | mean MAPE % | mean RMSE | mean ≤20% | mean t/img (s) |
|---|---:|---:|---:|---:|---:|---:|---:|
| unidepth_v2_l | 4 | 11.76 | 12.08 | 29.64 | 13.24 | 40.0 | 14.86 |
| da3_metric_large | 4 | 11.89 | 11.30 | 28.05 | 14.58 | 55.0 | 25.72 |

**Spread (worst − best mean MAE): 0.13 cm** — larger ⇒ this factor matters more.


## Factor: Segmentation mode (mask_mode)

| Level | # configs | mean MAE (cm) | median MAE | mean MAPE % | mean RMSE | mean ≤20% | mean t/img (s) |
|---|---:|---:|---:|---:|---:|---:|---:|
| gtmask | 4 | 5.28 | 4.65 | 14.16 | 6.13 | 85.0 | 19.68 |
| nomask | 4 | 18.36 | 18.49 | 43.53 | 21.69 | 10.0 | 20.90 |

**Spread (worst − best mean MAE): 13.09 cm** — larger ⇒ this factor matters more.


## Factor: Distance source (dist_mode)

| Level | # configs | mean MAE (cm) | median MAE | mean MAPE % | mean RMSE | mean ≤20% | mean t/img (s) |
|---|---:|---:|---:|---:|---:|---:|---:|
| refdist | 4 | 11.36 | 11.29 | 27.98 | 13.17 | 50.0 | 19.59 |
| nodist | 4 | 12.28 | 12.08 | 29.71 | 14.65 | 45.0 | 20.99 |

**Spread (worst − best mean MAE): 0.92 cm** — larger ⇒ this factor matters more.


## Extremes

- **Best**:  `unidepth_v2_l__gtmask__refdist` → MAE 3.82 cm, MAPE 9.1%, ≤20% 100%
- **Worst**: `da3_metric_large__nomask__nodist` → MAE 20.32 cm, MAPE 46.7%, ≤20% 20%