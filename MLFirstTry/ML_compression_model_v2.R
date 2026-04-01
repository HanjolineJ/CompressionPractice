# =============================================================================
# CompressionAction — Predictive Lossless Compression ML Framework  v2
# Author : Hanjoline Julceus  |  Stetson University  |  Spring 2026
# Advisor: Dr. Subhankar Banerjee
#
# Changes from v1 (ML_compression_model.R):
#   FIX-1  Added xz_savings to per-file feature set (was missing)
#   FIX-2  Removed circular entropy_proxy (= 1 - ratio_saved); kept as
#           a note until true Shannon entropy via readBin() is wired in
#   FIX-3  Removed train=test leakage fallback on tiny datasets;
#           now stops early with a clear message instead
#   FIX-4  Added classwt to randomForest() to handle class imbalance
#   FIX-5  Model is saved/loaded via saveRDS / readRDS so predict works
#           without re-training
#   FIX-6  predict_best_algorithm() validates inputs and emits a
#           low-confidence warning when max prob < CONF_THRESHOLD
#   FIX-7  file_ext feature extracted from log filename where possible
#   FIX-8  Confidence threshold constant at top of file
#   FIX-9  size_tier levels are locked so factor mismatch can't crash predict
#
# How to run (from the MLFirstTry/ directory):
#   Rscript ML_compression_model_v2.R
# =============================================================================


# ---- 0) Constants & reproducibility ----------------------------------------
set.seed(42)

# Minimum confidence for a recommendation (raise to 0.60 for stricter advice)
CONF_THRESHOLD  <- 0.40

# Path where the trained model is persisted between sessions
MODEL_RDS_PATH  <- "rf_model_v2.rds"

# Canonical size-tier levels — locked so train and predict always agree
SIZE_TIER_LEVELS <- c("tiny", "small", "medium", "large")

# Known algorithms — add new tools here as CompressionAction gains them
KNOWN_ALGOS <- c("bzip2", "gzip", "lz4", "xz", "zstd")


# ---- 1) Package Bootstrap ---------------------------------------------------
required_packages <- c(
  "readr", "dplyr", "tidyr", "caret",
  "randomForest", "rpart", "rpart.plot", "ggplot2"
)

for (pkg in required_packages) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    message("Installing missing package: ", pkg)
    install.packages(pkg, repos = "https://cloud.r-project.org", quiet = TRUE)
  }
}

suppressPackageStartupMessages({
  library(readr); library(dplyr); library(tidyr)
  library(caret); library(randomForest)
  library(rpart); library(rpart.plot); library(ggplot2)
})

cat("=============================================================\n")
cat("  CompressionAction — ML Framework v2  (Spring 2026)\n")
cat("=============================================================\n\n")


# ---- 2) Aggregate All Benchmark Logs ----------------------------------------
LOGS_DIR <- file.path("..", "compressionaction", "logs")

if (!dir.exists(LOGS_DIR)) {
  stop(
    "Logs directory not found at: ", LOGS_DIR,
    "\nPlease run this script from inside the MLFirstTry/ folder."
  )
}

csv_files <- list.files(LOGS_DIR, pattern = "^run_.*\\.csv$", full.names = TRUE)

if (length(csv_files) == 0) {
  stop("No run_*.csv files found in ", LOGS_DIR,
       "\nRun the Electron app on some files first to generate benchmark data.")
}

cat("Found", length(csv_files), "benchmark log file(s). Loading...\n")

raw_logs <- lapply(csv_files, function(f) {
  df <- tryCatch(
    read_csv(f, show_col_types = FALSE),
    error = function(e) NULL
  )
  if (!is.null(df)) df$log_file <- basename(f)
  df
})

raw_logs <- Filter(Negate(is.null), raw_logs)
df_raw   <- bind_rows(raw_logs)

cat("Total rows loaded:", nrow(df_raw), "\n\n")


# ---- 3) Validate Schema -----------------------------------------------------
required_cols <- c("tool", "src_bytes", "dst_bytes", "ratio_saved",
                   "compress_ms", "decompress_ms", "verified", "status")

missing_cols <- setdiff(required_cols, names(df_raw))
if (length(missing_cols) > 0) {
  stop("CSV is missing expected columns: ", paste(missing_cols, collapse = ", "),
       "\nCheck that you are using the latest version of the Electron app.")
}


# ---- 4) Feature Engineering -------------------------------------------------

# 4a — Keep only lossless-verified rows
df_valid <- df_raw %>%
  filter(tolower(verified) %in% c("yes", "true", "1"), tolower(status) == "ok")

if (nrow(df_valid) == 0) {
  stop("No verified/ok rows found. Check 'verified' and 'status' columns.")
}

# 4b — FIX-7: Extract a best-effort file extension from the log filename.
#   The log filename pattern is run_<timestamp>_<name>.csv  OR  run_<name>.csv
#   We grab whatever comes after the last underscore before .csv, then check
#   for a dot to see if it looks like an extension (e.g. "report.txt" → "txt").
#   Falls back to "unknown" when no extension can be inferred.
df_valid <- df_valid %>%
  mutate(
    stem_tmp = sub("\\.csv$", "", log_file),            # drop .csv
    last_tmp = sub("^.*_", "", stem_tmp),               # last token after _
    file_ext = ifelse(
      grepl("\\.", last_tmp),
      tolower(sub("^.*\\.", "", last_tmp)),      # e.g. "txt", "png"
      "unknown"
    ),
    tool = as.character(tool)
  ) %>%
  select(-stem_tmp, -last_tmp)


# 4c — Normalise per-file for usability scoring
df_valid <- df_valid %>%
  mutate(
    size_tier = case_when(
      src_bytes < 10000      ~ "tiny",
      src_bytes < 1000000    ~ "small",
      src_bytes < 100000000  ~ "medium",
      TRUE                   ~ "large"
    )
  ) %>%
  group_by(log_file) %>%
  mutate(
    norm_savings      = (ratio_saved - min(ratio_saved)) /
                          (max(ratio_saved) - min(ratio_saved) + 1e-9),
    norm_decomp_speed = 1 - (decompress_ms - min(decompress_ms)) /
                              (max(decompress_ms) - min(decompress_ms) + 1e-9),
    norm_comp_speed   = 1 - (compress_ms - min(compress_ms)) /
                              (max(compress_ms) - min(compress_ms) + 1e-9),
    norm_memory       = 1 - (dst_bytes - min(dst_bytes)) /
                              (max(dst_bytes) - min(dst_bytes) + 1e-9),

    usability_score   = 0.35 * norm_savings +
                        0.35 * norm_decomp_speed +
                        0.10 * norm_comp_speed +
                        0.20 * norm_memory
  ) %>%
  ungroup()


# 4d — Label: best algorithm per log file (highest usability score)
df_best <- df_valid %>%
  group_by(log_file) %>%
  slice_max(order_by = usability_score, n = 1, with_ties = FALSE) %>%
  ungroup() %>%
  select(log_file, best_algorithm = tool)

df_model <- df_valid %>% inner_join(df_best, by = "log_file")

cat("--- Feature Engineering Complete ---\n")
cat("Rows in modelling dataset:", nrow(df_model), "\n")
cat("Unique benchmark runs:    ", n_distinct(df_model$log_file), "\n")
cat("Algorithms in dataset:    ", paste(sort(unique(df_model$tool)), collapse = ", "), "\n\n")
cat("Best algorithm distribution:\n")
print(table(df_best$best_algorithm))
cat("\n")


# ---- 5) Prepare Per-File Modelling Frame ------------------------------------
# FIX-1: xz_savings is now included alongside the other per-algo savings cols.
# FIX-2: entropy_proxy removed — it was perfectly collinear with mean_savings
#         (entropy_proxy = 1 - ratio_saved, mean_savings = mean(ratio_saved)).
#         Once readBin()-based Shannon entropy is implemented, add it back here.

algo_savings_cols <- function(df, algo) {
  # Returns max ratio_saved for `algo` in this group, or NA if not present
  vals <- df$ratio_saved[df$tool == algo]
  if (length(vals) == 0) NA_real_ else max(vals, na.rm = TRUE)
}

max_or_na <- function(x) {
  if (all(is.na(x))) NA_real_ else max(x, na.rm = TRUE)
}

df_per_file <- df_model %>%
  group_by(log_file, best_algorithm) %>%
  summarise(
    src_bytes      = first(src_bytes),
    size_tier      = first(size_tier),
    file_ext       = first(file_ext),           # FIX-7
    mean_savings   = mean(ratio_saved),
    min_savings    = min(ratio_saved),
    max_savings    = max(ratio_saved),
    spread_savings = max(ratio_saved) - min(ratio_saved),
    mean_decomp_ms = mean(decompress_ms),
    mean_comp_ms   = mean(compress_ms),
    # Per-algo savings — FIX-1: xz added
    bzip2_savings  = max_or_na(ifelse(tool == "bzip2", ratio_saved, NA_real_)),
    gzip_savings   = max_or_na(ifelse(tool == "gzip",  ratio_saved, NA_real_)),
    lz4_savings    = max_or_na(ifelse(tool == "lz4",   ratio_saved, NA_real_)),
    xz_savings     = max_or_na(ifelse(tool == "xz",    ratio_saved, NA_real_)),
    zstd_savings   = max_or_na(ifelse(tool == "zstd",  ratio_saved, NA_real_)),
    .groups = "drop"
  ) %>%
  mutate(
    best_algorithm = as.factor(best_algorithm),
    # FIX-9: lock factor levels so train and predict always align
    size_tier      = factor(size_tier, levels = SIZE_TIER_LEVELS),
    file_ext       = as.factor(file_ext)
  )

# Replace NaN/Inf from per-algo savings when algo wasn't run on this file
df_per_file <- df_per_file %>%
  mutate(across(where(is.numeric), ~ifelse(is.nan(.) | is.infinite(.), NA_real_, .)))

# For missing per-algo savings, impute with the row's mean_savings as a neutral
# fallback (better than drop_na() losing whole rows when one algo wasn't tested)
algo_cols <- c("bzip2_savings", "gzip_savings", "lz4_savings",
               "xz_savings", "zstd_savings")
df_per_file <- df_per_file %>%
  mutate(across(all_of(algo_cols),
                ~ifelse(is.na(.), mean_savings, .)))

# Drop rows still NA in core features
df_per_file <- df_per_file %>%
  drop_na(src_bytes, mean_savings, mean_decomp_ms, mean_comp_ms)

cat("Per-file modelling rows:", nrow(df_per_file), "\n\n")

# FIX-3: Minimum sample guard — we need at least 10 rows and 2 classes.
#         Previously the code silently set train=test when <5 rows (data leakage).
MIN_ROWS    <- 10
MIN_CLASSES <- 2

n_rows    <- nrow(df_per_file)
n_classes <- dplyr::n_distinct(df_per_file$best_algorithm)

if (n_rows < MIN_ROWS) {
  stop(sprintf(
    "Only %d benchmark run(s) found — need at least %d.\n",
    n_rows, MIN_ROWS
  ), "Run the Electron app on more diverse files and re-run this script.")
}

if (n_classes < MIN_CLASSES) {
  stop(sprintf(
    "Only one algorithm ('%s') wins across all files.\n",
    as.character(unique(df_per_file$best_algorithm)[1])
  ), "Collect benchmark runs on varied file types so at least two algorithms win.")
}


# ---- 6) Train / Test Split --------------------------------------------------
# FIX-3 continued: no more train=test fallback.

features <- c(
  "src_bytes", "size_tier", "file_ext",
  "mean_savings", "min_savings", "max_savings", "spread_savings",
  "mean_decomp_ms", "mean_comp_ms",
  "bzip2_savings", "gzip_savings", "lz4_savings", "xz_savings", "zstd_savings"
)
target <- "best_algorithm"
all_target_levels <- levels(df_per_file[[target]])

train_idx  <- createDataPartition(df_per_file[[target]], p = 0.80, list = FALSE)
train_data <- df_per_file[train_idx,  c(features, target)]
test_data  <- df_per_file[-train_idx, c(features, target)]

# Drop unused levels after split; tiny folds can otherwise create one-level factors.
train_data <- droplevels(train_data)
test_data  <- droplevels(test_data)

# Remove zero-variance predictors (including one-level factors) for robust modeling.
active_features <- features[vapply(
  features,
  function(f) dplyr::n_distinct(train_data[[f]], na.rm = TRUE) > 1,
  logical(1)
)]

if (length(active_features) == 0) {
  stop("No usable predictors after filtering zero-variance features.")
}

if (length(active_features) < length(features)) {
  dropped <- setdiff(features, active_features)
  cat("Dropped zero-variance feature(s):", paste(dropped, collapse = ", "), "\n")
}

cat("Training samples:", nrow(train_data), "\n")
cat("Testing  samples:", nrow(test_data),  "\n\n")


# ---- 7a) Baseline: Decision Tree (rpart) ------------------------------------
cat("--- [Model 1] Decision Tree (Baseline) ---\n")

dt_model <- rpart(
  as.formula(paste(target, "~", paste(active_features, collapse = " + "))),
  data   = train_data,
  method = "class"
)

dt_preds <- factor(
  predict(dt_model, newdata = test_data, type = "class"),
  levels = all_target_levels
)
actuals <- factor(test_data[[target]], levels = all_target_levels)

dt_cm  <- confusionMatrix(dt_preds, actuals)
dt_acc <- dt_cm$overall["Accuracy"]
cat("Decision Tree Accuracy:", sprintf("%.1f%%", dt_acc * 100), "\n\n")


# ---- 7b) Primary: Random Forest ---------------------------------------------
cat("--- [Model 2] Random Forest (Primary Model) ---\n")

# FIX-4: Class weights inversely proportional to class frequency.
#   Without this, a majority class (e.g. bzip2) dominates and the model
#   achieves high accuracy by always predicting it.
class_counts <- table(train_data[[target]])
class_weights <- 1 / class_counts
class_weights <- class_weights / sum(class_weights) * length(class_weights)

cv_control <- trainControl(
  method          = "cv",
  number          = 5,
  savePredictions = "final",
  classProbs      = TRUE
)

rf_model <- train(
  as.formula(paste(target, "~", paste(active_features, collapse = " + "))),
  data      = train_data,
  method    = "rf",
  trControl = cv_control,
  ntree     = 500,
  tuneLength = 3,
  # FIX-4: pass class weights
  classwt   = class_weights
)

rf_preds <- factor(predict(rf_model, newdata = test_data),
                   levels = all_target_levels)
rf_cm    <- confusionMatrix(rf_preds, actuals)
rf_acc   <- rf_cm$overall["Accuracy"]

cat("Random Forest Accuracy:", sprintf("%.1f%%", rf_acc * 100), "\n\n")
cat("--- Full Confusion Matrix (Random Forest) ---\n")
print(rf_cm)
cat("\n")

# FIX-5: Save the trained model so predict_best_algorithm() can be called
#   from other scripts or sessions without re-training.
saveRDS(list(
  rf_model       = rf_model,
  dt_model       = dt_model,
  train_data     = train_data,
  model_features = active_features,
  size_tier_lvls = SIZE_TIER_LEVELS,
  file_ext_lvls  = unique(c(levels(train_data$file_ext), "unknown")),
  algo_lvls      = levels(train_data[[target]])
), MODEL_RDS_PATH)
cat("Model saved to:", MODEL_RDS_PATH, "\n\n")


# ---- 8) Feature Importance --------------------------------------------------
cat("--- Feature Importance (Random Forest) ---\n")

importance_df <- varImp(rf_model)$importance %>%
  as.data.frame() %>%
  tibble::rownames_to_column("feature") %>%
  arrange(desc(Overall)) %>%
  rename(importance = Overall)

print(importance_df, digits = 3)
cat("\n")


# ---- 9) Accuracy Comparison Table -------------------------------------------
cat("--- Model Comparison ---\n")
data.frame(
  Model    = c("Decision Tree (baseline)", "Random Forest (primary)"),
  Accuracy = c(sprintf("%.1f%%", dt_acc * 100), sprintf("%.1f%%", rf_acc * 100))
) |> print(row.names = FALSE)
cat("\n")


# ---- 10) Visualisations -----------------------------------------------------
OUTPUT_DIR <- "."

# 10a — Decision Tree plot
cat("Saving decision_tree.png ...\n")
png(file.path(OUTPUT_DIR, "decision_tree.png"), width = 1200, height = 700, res = 120)
rpart.plot(dt_model,
           main        = "Baseline Decision Tree — Best Compression Algorithm",
           box.palette = "auto",
           shadow.col  = "gray")
invisible(dev.off())

# 10b — Feature Importance bar chart
cat("Saving feature_importance.png ...\n")
fi_plot <- ggplot(importance_df, aes(x = reorder(feature, importance), y = importance)) +
  geom_col(fill = "#2196F3", width = 0.7) +
  coord_flip() +
  labs(
    title    = "Random Forest — Feature Importance",
    subtitle = "Higher value = more influential in predicting best algorithm",
    x        = NULL,
    y        = "Importance (Mean Decrease Gini)"
  ) +
  theme_minimal(base_size = 13) +
  theme(plot.title = element_text(face = "bold"))

ggsave(file.path(OUTPUT_DIR, "feature_importance.png"),
       fi_plot, width = 9, height = 5, dpi = 150)

# 10c — Usability score comparison
cat("Saving usability_scores.png ...\n")

usability_summary <- df_valid %>%
  group_by(tool) %>%
  summarise(
    mean_usability = mean(usability_score, na.rm = TRUE),
    sd_usability   = sd(usability_score,   na.rm = TRUE),
    .groups = "drop"
  )

us_plot <- ggplot(usability_summary,
                  aes(x = reorder(tool, mean_usability), y = mean_usability, fill = tool)) +
  geom_col(show.legend = FALSE, width = 0.6) +
  geom_errorbar(aes(ymin = mean_usability - sd_usability,
                    ymax = mean_usability + sd_usability),
                width = 0.25, colour = "grey40") +
  coord_flip() +
  scale_fill_brewer(palette = "Set2") +
  labs(
    title    = "Mean Weighted Usability Score by Algorithm",
    subtitle = "Weights: Storage 35% | Decomp Speed 35% | Memory 20% | Comp Speed 10%",
    x        = NULL,
    y        = "Usability Score (0–1)"
  ) +
  theme_minimal(base_size = 13) +
  theme(plot.title = element_text(face = "bold"))

ggsave(file.path(OUTPUT_DIR, "usability_scores.png"),
       us_plot, width = 8, height = 5, dpi = 150)

cat("All visualisations saved.\n\n")


# ---- 11) Prediction Function ------------------------------------------------
# FIX-5: Can also load a previously saved model instead of re-training.
#   Usage from another R script:
#     bundle <- readRDS("rf_model_v2.rds")
#     predict_best_algorithm(..., bundle = bundle)
#
# FIX-6: Input validation + low-confidence warning added.
# FIX-9: Factor levels are pinned from the saved bundle.

predict_best_algorithm <- function(
    src_bytes,
    mean_savings    = 0.60,
    min_savings     = 0.55,
    max_savings     = 0.65,
    spread_savings  = 0.10,
    mean_decomp_ms  = 10.0,
    mean_comp_ms    = 5.0,
    file_ext        = "unknown",
    bzip2_savings   = 0.65,
    gzip_savings    = 0.60,
    lz4_savings     = 0.60,
    xz_savings      = 0.63,     # FIX-1: xz_savings added
    zstd_savings    = 0.62,
    bundle          = NULL      # FIX-5: optional pre-loaded model bundle
) {

  # -- Load model if not provided in current environment --------------------
  if (is.null(bundle)) {
    if (!exists("rf_model")) {
      if (file.exists(MODEL_RDS_PATH)) {
        cat("Loading saved model from", MODEL_RDS_PATH, "...\n")
        bundle <- readRDS(MODEL_RDS_PATH)
      } else {
        stop("No trained model found. Run the full script first to train and save the model.")
      }
    } else {
      bundle <- list(
        rf_model       = rf_model,
        model_features = active_features,
        size_tier_lvls = SIZE_TIER_LEVELS,
        file_ext_lvls  = unique(c(levels(train_data$file_ext), "unknown")),
        algo_lvls      = levels(train_data[[target]])
      )
    }
  }

  # -- FIX-6: Input validation ----------------------------------------------
  stopifnot(
    "src_bytes must be a positive number"   = is.numeric(src_bytes) && src_bytes > 0,
    "mean_savings must be between 0 and 1"  = is.numeric(mean_savings) && mean_savings >= 0 && mean_savings <= 1,
    "mean_decomp_ms must be non-negative"   = is.numeric(mean_decomp_ms) && mean_decomp_ms >= 0,
    "mean_comp_ms must be non-negative"     = is.numeric(mean_comp_ms)   && mean_comp_ms   >= 0
  )

  # -- Build feature vector --------------------------------------------------
  size_tier <- factor(
    dplyr::case_when(
      src_bytes < 10000      ~ "tiny",
      src_bytes < 1000000    ~ "small",
      src_bytes < 100000000  ~ "medium",
      TRUE                   ~ "large"
    ),
    levels = bundle$size_tier_lvls  # FIX-9
  )

  # Map file_ext to known levels; fall back to "unknown" if unseen
  safe_ext <- if (file_ext %in% bundle$file_ext_lvls) file_ext else "unknown"
  file_ext_f <- factor(safe_ext, levels = bundle$file_ext_lvls)

  new_obs <- data.frame(
    src_bytes      = src_bytes,
    size_tier      = size_tier,
    file_ext       = file_ext_f,
    mean_savings   = mean_savings,
    min_savings    = min_savings,
    max_savings    = max_savings,
    spread_savings = spread_savings,
    mean_decomp_ms = mean_decomp_ms,
    mean_comp_ms   = mean_comp_ms,
    bzip2_savings  = bzip2_savings,
    gzip_savings   = gzip_savings,
    lz4_savings    = lz4_savings,
    xz_savings     = xz_savings,    # FIX-1
    zstd_savings   = zstd_savings
  )

  pred       <- predict(bundle$rf_model, newdata = new_obs)
  pred_probs <- predict(bundle$rf_model, newdata = new_obs, type = "prob")

  max_prob <- max(pred_probs)

  cat("\n--- Prediction for new file ---\n")
  cat("File size  :", formatC(src_bytes, format = "d", big.mark = ","), "bytes\n")
  cat("Size tier  :", as.character(size_tier), "\n")
  cat("File ext   :", file_ext, "\n")
  cat("\nRecommended algorithm:", as.character(pred), "\n")

  # FIX-6: Low-confidence warning
  if (max_prob < CONF_THRESHOLD) {
    cat(sprintf(
      "\n  [!] Low confidence (%.0f%% < threshold %.0f%%).\n",
      max_prob * 100, CONF_THRESHOLD * 100
    ))
    cat("      Consider running all algorithms and picking by usability score directly.\n")
    cat("      More training data will improve confidence.\n")
  }

  cat("\nConfidence scores:\n")
  print(round(pred_probs, 3))

  invisible(list(
    algorithm     = as.character(pred),
    probabilities = pred_probs,
    confident     = max_prob >= CONF_THRESHOLD
  ))
}


# ---- 12) Shannon Entropy stub (Phase 4 next step) --------------------------
# Uncomment and call compute_entropy(path) once you are ready to wire in
# true byte-level entropy. This replaces the circular entropy_proxy.
#
# compute_entropy <- function(filepath, sample_bytes = 65536L) {
#   if (!requireNamespace("entropy", quietly = TRUE))
#     install.packages("entropy", repos = "https://cloud.r-project.org")
#   raw <- readBin(filepath, what = "raw", n = sample_bytes)
#   byte_vals  <- as.integer(raw)
#   freq_table <- tabulate(byte_vals + 1L, nbins = 256L)
#   probs      <- freq_table / sum(freq_table)
#   probs      <- probs[probs > 0]
#   -sum(probs * log2(probs))   # bits per byte; 8.0 = fully random (PNG/zip)
# }
#
# Usage after wiring:
#   df_valid <- df_valid %>%
#     rowwise() %>%
#     mutate(shannon_entropy = compute_entropy(file_path_column)) %>%
#     ungroup()
#   features <- c(features, "shannon_entropy")


cat("=============================================================\n")
cat("  Training complete!  Key outputs:\n")
cat("  • decision_tree.png       — baseline model visualisation\n")
cat("  • feature_importance.png  — which features matter most\n")
cat("  • usability_scores.png    — algorithm performance overview\n")
cat("  • rf_model_v2.rds         — saved model for future predictions\n")
cat("\n")
cat("  To predict the best algorithm for a new file:\n")
cat("  predict_best_algorithm(src_bytes = <bytes>, file_ext = 'txt')\n")
cat("=============================================================\n")
