# Xiang Benchmark — Master Table

Sorted by MAE ascending. n=294 photos per row unless n_ok < n_total.


| Rank | Depth Model | Params (M) | Mask | Dist | n_ok | MAE (cm) | RMSE | MAPE % | ≤10% | ≤20% | Bias | t/img (s) |
|---:|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | UniDepth V2 ViT-L | 350 | gtmask | refdist | 5 | 3.82 | 4.70 | 9.08 | 60.0 | 100.0 | 1.42 | 13.93 |
| 2 | DA3 Metric Large | 400 | gtmask | refdist | 5 | 4.64 | 5.56 | 12.03 | 40.0 | 100.0 | 0.63 | 25.30 |
| 3 | DA3 Metric Large | 400 | gtmask | nodist | 5 | 4.66 | 5.88 | 10.68 | 40.0 | 100.0 | -4.53 | 25.55 |
| 4 | UniDepth V2 ViT-L | 350 | gtmask | nodist | 5 | 7.99 | 8.37 | 24.83 | 20.0 | 40.0 | 6.69 | 13.94 |
| 5 | UniDepth V2 ViT-L | 350 | nomask | nodist | 5 | 16.16 | 19.51 | 36.56 | 20.0 | 20.0 | -15.84 | 17.77 |
| 6 | DA3 Metric Large | 400 | nomask | refdist | 5 | 17.93 | 22.03 | 42.73 | 0.0 | 0.0 | -17.93 | 25.33 |
| 7 | UniDepth V2 ViT-L | 350 | nomask | refdist | 5 | 19.05 | 20.39 | 48.07 | 0.0 | 0.0 | -19.05 | 13.79 |
| 8 | DA3 Metric Large | 400 | nomask | nodist | 5 | 20.32 | 24.84 | 46.74 | 0.0 | 20.0 | -20.32 | 26.72 |