# Xiang Benchmark — Master Table

Sorted by MAE ascending. n=294 photos per row unless n_ok < n_total.


| Rank | Depth Model | Params (M) | Mask | Dist | n_ok | MAE (cm) | RMSE | MAPE % | ≤10% | ≤20% | Bias | t/img (s) |
|---:|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | DA V2 Metric Outdoor Small | 25 | gtmask | refdist | 5 | 3.26 | 4.41 | 7.17 | 80.0 | 100.0 | 1.66 | 1.44 |
| 2 | DA V2 Metric Outdoor Base | 98 | gtmask | refdist | 5 | 3.52 | 5.03 | 7.61 | 80.0 | 100.0 | 1.92 | 3.36 |
| 3 | DA V2 Metric Outdoor Large | 335 | gtmask | refdist | 5 | 3.57 | 5.06 | 7.74 | 80.0 | 100.0 | 1.98 | 10.16 |
| 4 | Apple Depth Pro | 350 | gtmask | refdist | 5 | 4.55 | 5.63 | 10.74 | 40.0 | 100.0 | 1.50 | 11.24 |
| 5 | Apple Depth Pro | 350 | gtmask | nodist | 5 | 6.49 | 8.59 | 16.06 | 40.0 | 60.0 | -1.93 | 11.36 |
| 6 | DA V2 Metric Outdoor Small | 25 | nomask | refdist | 5 | 12.67 | 13.83 | 35.49 | 0.0 | 20.0 | -7.61 | 1.45 |
| 7 | Apple Depth Pro | 350 | nomask | refdist | 5 | 13.23 | 15.01 | 34.31 | 0.0 | 0.0 | -8.52 | 11.38 |
| 8 | DA V2 Metric Outdoor Base | 98 | nomask | refdist | 5 | 15.67 | 16.13 | 42.72 | 0.0 | 0.0 | -15.67 | 3.24 |
| 9 | DA V2 Metric Outdoor Large | 335 | nomask | refdist | 5 | 20.72 | 21.59 | 53.92 | 0.0 | 0.0 | -20.72 | 9.47 |
| 10 | Apple Depth Pro | 350 | nomask | nodist | 5 | 25.53 | 35.67 | 55.86 | 0.0 | 20.0 | 5.32 | 11.32 |
| 11 | Apple Depth Pro | 350 | ? | ? | 2 | 41.98 | 52.31 | 78.40 | 0.0 | 0.0 | 31.22 | 11.28 |
| 12 | DA V2 Metric Outdoor Large | 335 | nomask | nodist | 4 | 42.57 | 42.98 | 131.70 | 0.0 | 0.0 | 42.57 | 26.57 |
| 13 | DA V2 Metric Outdoor Base | 98 | nomask | nodist | 5 | 55.12 | 60.62 | 150.85 | 0.0 | 0.0 | 55.12 | 5.93 |
| 14 | DA V2 Metric Outdoor Small | 25 | gtmask | nodist | 5 | 121.41 | 122.85 | 335.94 | 0.0 | 0.0 | 121.41 | 1.45 |
| 15 | DA V2 Metric Outdoor Base | 98 | gtmask | nodist | 5 | 126.09 | 127.32 | 352.83 | 0.0 | 0.0 | 126.09 | 3.30 |
| 16 | DA V2 Metric Outdoor Large | 335 | gtmask | nodist | 5 | 133.10 | 134.74 | 368.80 | 0.0 | 0.0 | 133.10 | 10.02 |
| 17 | DA V2 Metric Outdoor Small | 25 | nomask | nodist | 5 | 148.73 | 228.70 | 321.31 | 0.0 | 0.0 | 148.73 | 4.07 |