# MLFirstTry — Upgraded Machine Learning Model
**CompressionAction Senior Project | Hanjoline Julceus | Stetson University 2026**

---

## What this script does

`ML_compression_model.R` is a full upgrade over the original `R_baseline.R` Decision Tree.
It implements the five-phase framework described in the research plan:

| Phase | What happens |
|---|---|
| 1 | Loads **all** `run_*.csv` logs from `compressionaction/logs/` automatically |
| 2 | Engineers features: entropy proxy, usability score, size tier, per-algo savings |
| 3 | Trains a **Random Forest** (primary) + Decision Tree (baseline for comparison) |
| 4 | Evaluates with Confusion Matrix, per-class precision/recall, feature importance |
| 5 | Exposes `predict_best_algorithm()` — call it with any file's stats |

---

## Quick start in VS Code

### Prerequisites (install once)

1. **R 4.0+** — https://r-project.org  
2. **R Extension for VS Code** by Yuki Ueda — search in the Extensions panel  
3. Required R packages are **auto-installed** on first run — no manual setup needed

### Run the script

```bash
# From a terminal opened inside VS Code (Ctrl + `)
# Navigate to the MLFirstTry folder
cd path/to/CompressionPractice/MLFirstTry

# Run the full pipeline
Rscript ML_compression_model.R
```

Or open `ML_compression_model.R` in VS Code and run line-by-line with **Ctrl+Enter** using the R extension.

---

## Generated output files

| File | Description |
|---|---|
| `decision_tree.png` | Visual tree diagram of the baseline model |
| `feature_importance.png` | Bar chart — which features the Random Forest relies on most |
| `usability_scores.png` | Mean weighted usability score per algorithm across all runs |

---

## Predict the best algorithm for a new file

After training, call `predict_best_algorithm()` in your R console with the benchmark
metrics from a new file (after running it through the Electron app):

```r
predict_best_algorithm(
  src_bytes      = 74796,    # file size in bytes
  mean_savings   = 0.63,     # average ratio_saved across all algorithms
  mean_decomp_ms = 5.0       # average decompression time in ms
)
```

All other parameters have sensible defaults; update them for more precise predictions.

---

## Weighted Usability Score formula

Based on the research plan (Section 8):

```
UsabilityScore = 0.35 × StorageSavings
              + 0.35 × DecompressionSpeed   (inverted ms)
              + 0.10 × CompressionSpeed      (inverted ms)
              + 0.20 × MemoryProxy           (inverted compressed size)
              − Penalties                    (if decomp fails SHA-256 check)
```

All sub-scores are normalised to [0, 1] per benchmark run before weighting.

---

## How to get more training data

The model's accuracy improves with more benchmark runs. From the Electron app:
1. Drag in files of different types (`.txt`, `.bin`, `.png`, `.exe`, etc.)
2. Run all algorithms and save results
3. Re-run `Rscript ML_compression_model.R` — it picks up all new CSVs automatically

---

## Next steps (Phase 4 & 5 of the research plan)

- Add **Shannon entropy** by reading raw binary with `readBin()` and the `entropy` package
- Add **magic number** detection (first 4 bytes) for format-aware recommendations
- Wire the `predict_best_algorithm()` output back into the Electron UI
- Explore **XGBoost** (`xgboost` package) as a third model for comparison