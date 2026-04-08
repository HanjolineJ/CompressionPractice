# =============================================================================
# ML_compression_model_v3.R  — CompressionAction
# Author : Hanjoline Julceus  |  Stetson University  |  Spring 2026
# Advisor: Dr. Subhankar Banerjee
#
# What changed from v2:
#
#  SCHEMA-1  Reads the three new CSV columns written by compressRunner.js v2:
#              file_name, file_ext, file_path
#            file_ext is now the REAL extension logged by the backend, not
#            a guess extracted from the run filename (which was almost always
#            "unknown" because run filenames are timestamps).
#
#  SCHEMA-2  required_cols updated to include the new columns.  Older CSVs
#            produced by the original compressRunner will be detected and
#            either patched with NA or skipped with a warning.
#
#  EVAL-1    Replaced overall accuracy with macro-averaged F1 as the primary
#            metric.  With imbalanced classes (17 bzip2 : 1 gzip) overall
#            accuracy is misleading — a model that always predicts bzip2 gets
#            94% accuracy but 0% F1 on every minority class.
#
#  EVAL-2    Balanced accuracy (mean per-class recall) is also reported.
#
#  EVAL-3    Holdout strategy changed from random row split to file-family
#            holdout: one entire project/corpus (identified by file_path
#            prefix) is held out as the test set.  This tests whether the
#            model generalises to unseen corpora, not just unseen rows from
#            the same files.
#
#  ENTROPY-1 True Shannon entropy via readBin() is now computed and added as
#            a feature.  The old circular entropy_proxy = 1 - ratio_saved is
#            removed entirely.  Shannon entropy is the single most important
#            predictor of compression behaviour.
#
#  DATA-1    Synthetic CSVs from generate_game_file_benchmarks.R are excluded
#            from training.  The script detects them by checking whether
#            file_path contains a real path (starts with / or a drive letter)
#            vs a synthetic placeholder.
#
# How to run (from the MLFirstTry/ directory):
#   Rscript ML_compression_model_v3.R
# =============================================================================


# ---- 0) Constants & reproducibility ----------------------------------------
set.seed(42)

CONF_THRESHOLD   <- 0.40          # minimum confidence to trust a prediction
MODEL_RDS_PATH   <- "rf_model_v3.rds"
SIZE_TIER_LEVELS <- c("tiny", "small", "medium", "large")
KNOWN_ALGOS      <- c("bzip2", "gzip", "lz4", "xz", "zstd")

# Number of bytes to sample for Shannon entropy (64 KB is fast and sufficient)
ENTROPY_SAMPLE_BYTES <- 65536L


# ---- 1) Package Bootstrap ---------------------------------------------------
required_packages <- c(
  "readr", "dplyr", "tidyr", "caret",
  "randomForest", "rpart", "rpart.plot", "ggplot2", "tibble"
)

for (pkg in required_packages) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    message("Installing: ", pkg)
    install.packages(pkg, repos = "https://cloud.r-project.org", quiet = TRUE)
  }
}

suppressPackageStartupMessages({
  library(readr); library(dplyr); library(tidyr); library(tibble)
  library(caret); library(randomForest)
  library(rpart); library(rpart.plot); library(ggplot2)
})

cat("=============================================================\n")
cat("  CompressionAction — ML Framework v3  (Spring 2026)\n")
cat("=============================================================\n\n")


# ---- 2) Shannon Entropy Function --------------------------------------------
# Reads up to ENTROPY_SAMPLE_BYTES raw bytes from a file and computes
# Shannon entropy in bits/byte.  Range: 0.0 (all same byte) to 8.0 (random).
# Values near 8.0 mean the file is already compressed — lz4 will win.
# Values near 4-6 are typical text — bzip2/xz will win.
compute_entropy <- function(filepath, sample_bytes = ENTROPY_SAMPLE_BYTES) {
  if (!file.exists(filepath) || !nzchar(filepath)) return(NA_real_)
  tryCatch({
    raw_bytes  <- readBin(filepath, what = "raw", n = sample_bytes)
    byte_vals  <- as.integer(raw_bytes)
    freq_table <- tabulate(byte_vals + 1L, nbins = 256L)
    probs      <- freq_table / sum(freq_table)
    probs      <- probs[probs > 0]
    -sum(probs * log2(probs))
  }, error = function(e) NA_real_)
}


# ---- 3) Aggregate All Benchmark Logs ----------------------------------------
LOGS_DIR <- file.path("..", "compressionaction", "logs")

if (!dir.exists(LOGS_DIR)) {
  stop("Logs directory not found at: ", LOGS_DIR,
       "\nRun from inside the MLFirstTry/ folder.")
}

csv_files <- list.files(LOGS_DIR, pattern = "^run_.*\\.csv$", full.names = TRUE)

if (length(csv_files) == 0) {
  stop("No run_*.csv files found in ", LOGS_DIR,
       "\nRun the Electron app on real files first.")
}

cat("Found", length(csv_files), "benchmark log file(s). Loading...\n")

raw_logs <- lapply(csv_files, function(f) {
  df <- tryCatch(read_csv(f, show_col_types = FALSE), error = function(e) NULL)
  if (!is.null(df)) df$log_file <- basename(f)
  df
})

raw_logs <- Filter(Negate(is.null), raw_logs)
df_raw   <- bind_rows(raw_logs)

cat("Total rows loaded:", nrow(df_raw), "\n\n")


# ---- 4) Schema Validation & Back-compat Patching ----------------------------
# SCHEMA-2: New columns may be absent in CSVs from the old compressRunner.
# Patch them with NA rather than crashing — old rows will get file_ext = NA
# and will be excluded from file-family holdout but can still train.

new_cols <- c("file_name", "file_ext", "file_path")
for (col in new_cols) {
  if (!col %in% names(df_raw)) {
    df_raw[[col]] <- NA_character_
    message("Back-compat patch: column '", col,
            "' missing from some CSVs — set to NA.")
  }
}

required_cols <- c("tool", "src_bytes", "dst_bytes", "ratio_saved",
                   "compress_ms", "decompress_ms", "verified", "status")
missing_cols  <- setdiff(required_cols, names(df_raw))
if (length(missing_cols) > 0) {
  stop("CSV is missing required columns: ", paste(missing_cols, collapse = ", "),
       "\nUpdate your compressRunner.js to the v3 schema.")
}


# ---- 5) Exclude Synthetic Rows ----------------------------------------------
# DATA-1: Rows where file_path does not look like a real filesystem path
# (i.e., synthetic rows from generate_game_file_benchmarks.R) are excluded.
# Real paths start with "/" on macOS/Linux or a drive letter on Windows.
is_real_path <- function(p) {
  !is.na(p) & nzchar(p) & (grepl("^/", p) | grepl("^[A-Za-z]:\\\\", p))
}

n_before <- nrow(df_raw)
df_raw   <- df_raw %>%
  filter(is.na(file_path) | is_real_path(file_path))   # keep NAs (old schema)
n_synth  <- n_before - nrow(df_raw)
if (n_synth > 0) cat("Excluded", n_synth, "synthetic row(s).\n")


# ---- 6) Feature Engineering -------------------------------------------------

# 6a — Keep only lossless-verified rows
df_valid <- df_raw %>%
  filter(tolower(verified) %in% c("yes", "true", "1"), tolower(status) == "ok")

if (nrow(df_valid) == 0) {
  stop("No verified/ok rows found after filtering.")
}

# 6b — SCHEMA-1: Use real file_ext when available; fall back to guessing
#      from log filename only for rows from the old compressRunner schema.
df_valid <- df_valid %>%
  mutate(
    # Real extension from backend (new schema)
    ext_from_backend = tolower(trimws(as.character(file_ext))),
    # Fallback: guess from log filename (old schema)
    stem_tmp = sub("\\.csv$", "", log_file),
    last_tmp = sub("^.*_", "", stem_tmp),
    ext_from_filename = ifelse(
      grepl("\\.", last_tmp),
      tolower(sub("^.*\\.", "", last_tmp)),
      "unknown"
    ),
    # Use real extension if available, otherwise use filename guess
    file_ext_clean = ifelse(
      !is.na(ext_from_backend) & nzchar(ext_from_backend) &
        ext_from_backend != "na",
      ext_from_backend,
      ext_from_filename
    ),
    tool = as.character(tool)
  ) %>%
  select(-stem_tmp, -last_tmp, -ext_from_backend, -ext_from_filename)

# 6c — Compute Shannon entropy for each unique file path
#      ENTROPY-1: replaces the old circular proxy (1 - ratio_saved).
#      This reads actual bytes, so it takes a few seconds per unique file.
unique_paths <- unique(df_valid$file_path[is_real_path(df_valid$file_path)])

if (length(unique_paths) > 0) {
  cat("Computing Shannon entropy for", length(unique_paths), "unique file(s)...\n")
  entropy_map <- setNames(
    vapply(unique_paths, compute_entropy, numeric(1)),
    unique_paths
  )
  df_valid <- df_valid %>%
    mutate(shannon_entropy = ifelse(
      is_real_path(file_path),
      entropy_map[file_path],
      NA_real_
    ))
  cat("Entropy range: [",
      round(min(df_valid$shannon_entropy, na.rm = TRUE), 2), ",",
      round(max(df_valid$shannon_entropy, na.rm = TRUE), 2), "] bits/byte\n\n")
} else {
  cat("No real file paths found — shannon_entropy set to NA (old schema logs).\n\n")
  df_valid$shannon_entropy <- NA_real_
}

# 6d — Size tier and usability score
df_valid <- df_valid %>%
  mutate(
    size_tier = case_when(
      src_bytes < 10000     ~ "tiny",
      src_bytes < 1000000   ~ "small",
      src_bytes < 100000000 ~ "medium",
      TRUE                  ~ "large"
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
    usability_score   = 0.35 * norm_savings  +
                        0.35 * norm_decomp_speed +
                        0.10 * norm_comp_speed   +
                        0.20 * norm_memory
  ) %>%
  ungroup()

# 6e — Label: best algorithm per log file
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


# ---- 7) Per-File Modelling Frame --------------------------------------------
max_or_na <- function(x) if (all(is.na(x))) NA_real_ else max(x, na.rm = TRUE)

df_per_file <- df_model %>%
  group_by(log_file, best_algorithm) %>%
  summarise(
    src_bytes       = first(src_bytes),
    size_tier       = first(size_tier),
    file_ext        = first(file_ext_clean),
    file_path       = first(file_path),
    # ENTROPY-1: real Shannon entropy (NA for old-schema rows)
    shannon_entropy = first(shannon_entropy),
    mean_savings    = mean(ratio_saved),
    min_savings     = min(ratio_saved),
    max_savings     = max(ratio_saved),
    spread_savings  = max(ratio_saved) - min(ratio_saved),
    mean_decomp_ms  = mean(decompress_ms),
    mean_comp_ms    = mean(compress_ms),
    bzip2_savings   = max_or_na(ifelse(tool == "bzip2", ratio_saved, NA_real_)),
    gzip_savings    = max_or_na(ifelse(tool == "gzip",  ratio_saved, NA_real_)),
    lz4_savings     = max_or_na(ifelse(tool == "lz4",   ratio_saved, NA_real_)),
    xz_savings      = max_or_na(ifelse(tool == "xz",    ratio_saved, NA_real_)),
    zstd_savings    = max_or_na(ifelse(tool == "zstd",  ratio_saved, NA_real_)),
    .groups = "drop"
  ) %>%
  mutate(
    best_algorithm  = as.factor(best_algorithm),
    size_tier       = factor(size_tier, levels = SIZE_TIER_LEVELS),
    file_ext        = as.factor(file_ext)
  )

# Impute missing per-algo savings with row mean (when algo wasn't run)
algo_cols <- c("bzip2_savings","gzip_savings","lz4_savings","xz_savings","zstd_savings")
df_per_file <- df_per_file %>%
  mutate(across(all_of(algo_cols), ~ifelse(is.na(.) | is.infinite(.) | is.nan(.), mean_savings, .)))

# Drop rows still NA in core numerics
df_per_file <- df_per_file %>%
  drop_na(src_bytes, mean_savings, mean_decomp_ms, mean_comp_ms)

cat("Per-file modelling rows:", nrow(df_per_file), "\n\n")

# Minimum data guard
if (nrow(df_per_file) < 10) {
  stop("Only ", nrow(df_per_file), " benchmark runs found — need at least 10.\n",
       "Run the Electron app on more files.")
}
if (dplyr::n_distinct(df_per_file$best_algorithm) < 2) {
  stop("Only one algorithm wins across all files.\n",
       "Benchmark pre-compressed files (.zip, .png, .jpg) to get lz4 wins.")
}


# ---- 8) Train / Test Split — File-Family Holdout ----------------------------
# EVAL-3: Instead of random row split, hold out one entire file family
# (identified by the top-level directory of file_path).  This tests whether
# the model generalises to a completely unseen corpus.
#
# Logic: extract the top directory from each file_path; hold out the
# family that has the most diverse set of algorithms winning, so the
# holdout is a meaningful evaluation.  Fall back to random split if
# file_path is unavailable (old-schema rows).

features_with_entropy <- c(
  "src_bytes", "size_tier", "file_ext",
  "mean_savings", "min_savings", "max_savings", "spread_savings",
  "mean_decomp_ms", "mean_comp_ms",
  "bzip2_savings", "gzip_savings", "lz4_savings", "xz_savings", "zstd_savings",
  "shannon_entropy"
)
target <- "best_algorithm"

has_real_paths <- any(is_real_path(df_per_file$file_path))

if (has_real_paths) {
  # Derive file family = top ancestor directory in the path
  df_per_file <- df_per_file %>%
    mutate(
      file_family = ifelse(
        is_real_path(file_path),
        # Extract the second component: /Users/hanjo/CompressionPractice/DataToTest/... → DataToTest
        sapply(strsplit(file_path, .Platform$file.sep), function(parts) {
          parts <- parts[nzchar(parts)]
          if (length(parts) >= 2) parts[2] else parts[1]
        }),
        "unknown"
      )
    )

  families    <- unique(df_per_file$file_family[df_per_file$file_family != "unknown"])
  holdout_fam <- if (length(families) >= 2) {
    # Hold out the family with the most diverse algorithm winners
    family_diversity <- df_per_file %>%
      filter(file_family %in% families) %>%
      group_by(file_family) %>%
      summarise(n_algos = n_distinct(best_algorithm), .groups = "drop") %>%
      arrange(desc(n_algos))
    family_diversity$file_family[1]
  } else {
    families[1]
  }

  cat("File-family holdout: '", holdout_fam, "'\n", sep = "")

  train_data <- df_per_file %>%
    filter(file_family != holdout_fam) %>%
    select(all_of(c(features_with_entropy, target)))

  test_data <- df_per_file %>%
    filter(file_family == holdout_fam) %>%
    select(all_of(c(features_with_entropy, target)))

} else {
  cat("No real file paths — falling back to stratified random split.\n")
  train_idx  <- createDataPartition(df_per_file[[target]], p = 0.80, list = FALSE)
  train_data <- df_per_file[train_idx,  c(features_with_entropy, target)]
  test_data  <- df_per_file[-train_idx, c(features_with_entropy, target)]
}

# Drop unused factor levels after split
train_data <- droplevels(train_data)
test_data  <- droplevels(test_data)
all_target_levels <- levels(df_per_file[[target]])

# Remove zero-variance predictors (e.g. shannon_entropy all NA, or single-level factors)
active_features <- features_with_entropy[vapply(
  features_with_entropy,
  function(f) dplyr::n_distinct(train_data[[f]], na.rm = TRUE) > 1,
  logical(1)
)]

if (length(active_features) < length(features_with_entropy)) {
  dropped <- setdiff(features_with_entropy, active_features)
  cat("Dropped zero-variance feature(s):", paste(dropped, collapse = ", "), "\n")
}

cat("Training samples:", nrow(train_data), "\n")
cat("Testing  samples:", nrow(test_data),  "\n\n")

if (nrow(train_data) == 0 || nrow(test_data) == 0) {
  stop("Train or test split is empty — collect more diverse benchmark files.")
}


# ---- 9a) Baseline: Decision Tree --------------------------------------------
cat("--- [Model 1] Decision Tree (Baseline) ---\n")

dt_model <- rpart(
  as.formula(paste(target, "~", paste(active_features, collapse = " + "))),
  data = train_data, method = "class"
)

dt_preds <- factor(predict(dt_model, newdata = test_data, type = "class"),
                   levels = all_target_levels)
actuals  <- factor(test_data[[target]], levels = all_target_levels)

dt_cm  <- confusionMatrix(dt_preds, actuals)
dt_acc <- dt_cm$overall["Accuracy"]
cat("Decision Tree Accuracy:", sprintf("%.1f%%", dt_acc * 100), "\n\n")


# ---- 9b) Primary: Random Forest --------------------------------------------
cat("--- [Model 2] Random Forest (Primary Model) ---\n")

# Class weights inversely proportional to class frequency
class_counts  <- table(train_data[[target]])
class_weights <- 1 / class_counts
class_weights <- class_weights / sum(class_weights) * length(class_weights)

# CV folds: cap at min(5, minority_class_count) so tiny minority classes
# always appear in every fold
minority_n <- min(class_counts)
n_folds    <- max(2, min(5, as.integer(minority_n)))
cat("Using", n_folds, "-fold CV (minority class has", minority_n, "sample(s)).\n")

cv_control <- trainControl(
  method          = "cv",
  number          = n_folds,
  savePredictions = "final",
  classProbs      = TRUE
)

rf_model <- train(
  as.formula(paste(target, "~", paste(active_features, collapse = " + "))),
  data       = train_data,
  method     = "rf",
  trControl  = cv_control,
  ntree      = 500,
  tuneLength = 3,
  classwt    = class_weights
)

rf_preds <- factor(predict(rf_model, newdata = test_data),
                   levels = all_target_levels)
rf_cm    <- confusionMatrix(rf_preds, actuals)
rf_acc   <- rf_cm$overall["Accuracy"]

cat("Random Forest Accuracy:", sprintf("%.1f%%", rf_acc * 100), "\n\n")
cat("--- Full Confusion Matrix (Random Forest) ---\n")
print(rf_cm)
cat("\n")


# ---- 10) EVAL-1 & EVAL-2: Macro-F1 and Balanced Accuracy -------------------
# Overall accuracy is misleading with imbalanced classes.
# Macro-F1 = unweighted average F1 across all classes.
# A model that always predicts bzip2 gets macro-F1 ≈ 0.2 (not 94%).

cat("--- Per-class Precision / Recall / F1 ---\n")

per_class <- rf_cm$byClass
if (is.null(dim(per_class))) {
  # Only two classes — byClass returns a named vector, not a matrix
  per_class <- t(as.matrix(per_class))
  rownames(per_class) <- levels(actuals)[1]
}

f1_per_class <- per_class[, "F1"]
macro_f1     <- mean(f1_per_class, na.rm = TRUE)
bal_acc      <- mean(per_class[, "Balanced Accuracy"], na.rm = TRUE)

print(round(data.frame(
  Precision       = per_class[, "Precision"],
  Recall          = per_class[, "Recall"],
  F1              = per_class[, "F1"],
  BalancedAcc     = per_class[, "Balanced Accuracy"]
), 3))

cat(sprintf("\nMacro-averaged F1      : %.3f\n", macro_f1))
cat(sprintf("Overall balanced accuracy: %.3f\n\n", bal_acc))

cat("--- Model Comparison ---\n")
data.frame(
  Model          = c("Decision Tree (baseline)", "Random Forest (primary)"),
  Accuracy       = c(sprintf("%.1f%%", dt_acc * 100), sprintf("%.1f%%", rf_acc * 100)),
  Macro_F1       = c("—", sprintf("%.3f", macro_f1)),
  Balanced_Acc   = c("—", sprintf("%.3f", bal_acc))
) |> print(row.names = FALSE)
cat("\n")


# ---- 11) Feature Importance -------------------------------------------------
cat("--- Feature Importance (Random Forest) ---\n")

importance_df <- varImp(rf_model)$importance %>%
  as.data.frame() %>%
  rownames_to_column("feature") %>%
  arrange(desc(Overall)) %>%
  rename(importance = Overall)

print(importance_df, digits = 3)
cat("\n")


# ---- 12) Save Model ---------------------------------------------------------
saveRDS(list(
  rf_model        = rf_model,
  dt_model        = dt_model,
  model_features  = active_features,
  size_tier_lvls  = SIZE_TIER_LEVELS,
  file_ext_lvls   = unique(c(levels(train_data$file_ext), "unknown")),
  algo_lvls       = all_target_levels,
  macro_f1        = macro_f1,
  balanced_acc    = bal_acc
), MODEL_RDS_PATH)
cat("Model saved to:", MODEL_RDS_PATH, "\n\n")


# ---- 13) Visualisations -----------------------------------------------------
OUTPUT_DIR <- "."

# 13a — Decision tree
cat("Saving decision_tree.png ...\n")
png(file.path(OUTPUT_DIR, "decision_tree.png"), width = 1200, height = 700, res = 120)
rpart.plot(dt_model,
           main        = "Baseline Decision Tree — Best Compression Algorithm",
           box.palette = "auto", shadow.col = "gray")
invisible(dev.off())

# 13b — Feature importance
cat("Saving feature_importance.png ...\n")
fi_plot <- ggplot(importance_df,
                  aes(x = reorder(feature, importance), y = importance)) +
  geom_col(fill = "#2196F3", width = 0.7) +
  coord_flip() +
  labs(title    = "Random Forest — Feature Importance",
       subtitle = "Higher value = more influential in predicting best algorithm",
       x = NULL, y = "Importance (Mean Decrease Gini)") +
  theme_minimal(base_size = 13) +
  theme(plot.title = element_text(face = "bold"))
ggsave(file.path(OUTPUT_DIR, "feature_importance.png"),
       fi_plot, width = 9, height = 5, dpi = 150)

# 13c — Usability scores
cat("Saving usability_scores.png ...\n")
usability_summary <- df_valid %>%
  group_by(tool) %>%
  summarise(mean_usability = mean(usability_score, na.rm = TRUE),
            sd_usability   = sd(usability_score,   na.rm = TRUE),
            .groups = "drop")

us_plot <- ggplot(usability_summary,
                  aes(x = reorder(tool, mean_usability),
                      y = mean_usability, fill = tool)) +
  geom_col(show.legend = FALSE, width = 0.6) +
  geom_errorbar(aes(ymin = mean_usability - sd_usability,
                    ymax = mean_usability + sd_usability),
                width = 0.25, colour = "grey40") +
  coord_flip() +
  scale_fill_brewer(palette = "Set2") +
  labs(title    = "Mean Weighted Usability Score by Algorithm",
       subtitle = "Weights: Storage 35% | Decomp Speed 35% | Memory 20% | Comp Speed 10%",
       x = NULL, y = "Usability Score (0–1)") +
  theme_minimal(base_size = 13) +
  theme(plot.title = element_text(face = "bold"))
ggsave(file.path(OUTPUT_DIR, "usability_scores.png"),
       us_plot, width = 8, height = 5, dpi = 150)

# 13d — EVAL-1: Per-class F1 bar chart (new — shows real model performance)
cat("Saving per_class_f1.png ...\n")
f1_df <- data.frame(
  algorithm = names(f1_per_class),
  f1_score  = as.numeric(f1_per_class)
) %>% filter(!is.na(f1_score))

f1_plot <- ggplot(f1_df, aes(x = reorder(algorithm, f1_score),
                              y = f1_score, fill = algorithm)) +
  geom_col(show.legend = FALSE, width = 0.6) +
  geom_hline(yintercept = macro_f1, linetype = "dashed",
             colour = "grey40", linewidth = 0.7) +
  annotate("text", x = 0.6, y = macro_f1 + 0.02,
           label = sprintf("Macro avg: %.2f", macro_f1),
           hjust = 0, size = 3.5, colour = "grey30") +
  coord_flip() +
  scale_fill_brewer(palette = "Set2") +
  labs(title    = "Random Forest — Per-class F1 Score",
       subtitle = "Dashed line = macro-averaged F1  |  1.0 = perfect",
       x = NULL, y = "F1 Score") +
  ylim(0, 1) +
  theme_minimal(base_size = 13) +
  theme(plot.title = element_text(face = "bold"))
ggsave(file.path(OUTPUT_DIR, "per_class_f1.png"),
       f1_plot, width = 8, height = 4, dpi = 150)

cat("All visualisations saved.\n\n")


# ---- 14) Prediction Function ------------------------------------------------
predict_best_algorithm <- function(
    src_bytes,
    mean_savings    = 0.60,
    min_savings     = 0.55,
    max_savings     = 0.65,
    spread_savings  = 0.10,
    mean_decomp_ms  = 10.0,
    mean_comp_ms    = 5.0,
    file_ext        = "unknown",
    shannon_entropy = NA_real_,  # provide this if you can read the file
    bzip2_savings   = 0.65,
    gzip_savings    = 0.60,
    lz4_savings     = 0.60,
    xz_savings      = 0.63,
    zstd_savings    = 0.62,
    bundle          = NULL
) {
  if (is.null(bundle)) {
    if (!exists("rf_model")) {
      if (file.exists(MODEL_RDS_PATH)) {
        cat("Loading saved model from", MODEL_RDS_PATH, "...\n")
        bundle <- readRDS(MODEL_RDS_PATH)
      } else {
        stop("No trained model found. Run this script first.")
      }
    } else {
      bundle <- list(rf_model = rf_model, model_features = active_features,
                     size_tier_lvls = SIZE_TIER_LEVELS,
                     file_ext_lvls  = levels(train_data$file_ext),
                     algo_lvls      = all_target_levels)
    }
  }

  stopifnot(
    "src_bytes must be positive"          = is.numeric(src_bytes) && src_bytes > 0,
    "mean_savings must be between 0 and 1"= is.numeric(mean_savings) && mean_savings >= 0 && mean_savings <= 1,
    "mean_decomp_ms must be non-negative" = is.numeric(mean_decomp_ms) && mean_decomp_ms >= 0,
    "mean_comp_ms must be non-negative"   = is.numeric(mean_comp_ms) && mean_comp_ms >= 0
  )

  size_tier_val <- dplyr::case_when(
    src_bytes < 10000     ~ "tiny",
    src_bytes < 1000000   ~ "small",
    src_bytes < 100000000 ~ "medium",
    TRUE                  ~ "large"
  )
  size_tier <- factor(size_tier_val, levels = bundle$size_tier_lvls)

  safe_ext   <- if (file_ext %in% bundle$file_ext_lvls) file_ext else "unknown"
  file_ext_f <- factor(safe_ext, levels = bundle$file_ext_lvls)

  new_obs <- data.frame(
    src_bytes = src_bytes, size_tier = size_tier, file_ext = file_ext_f,
    mean_savings = mean_savings, min_savings = min_savings,
    max_savings  = max_savings,  spread_savings = spread_savings,
    mean_decomp_ms = mean_decomp_ms, mean_comp_ms = mean_comp_ms,
    bzip2_savings  = bzip2_savings,  gzip_savings = gzip_savings,
    lz4_savings    = lz4_savings,    xz_savings   = xz_savings,
    zstd_savings   = zstd_savings,   shannon_entropy = shannon_entropy
  )

  # Only include features the model was trained on
  new_obs    <- new_obs[, intersect(names(new_obs), bundle$model_features), drop = FALSE]
  pred       <- predict(bundle$rf_model, newdata = new_obs)
  pred_probs <- predict(bundle$rf_model, newdata = new_obs, type = "prob")
  max_prob   <- max(pred_probs)

  cat("\n--- Prediction for new file ---\n")
  cat("File size     :", formatC(src_bytes, format = "d", big.mark = ","), "bytes\n")
  cat("Size tier     :", as.character(size_tier), "\n")
  cat("File extension:", file_ext, "\n")
  if (!is.na(shannon_entropy))
    cat("Entropy       :", round(shannon_entropy, 3), "bits/byte\n")
  cat("\nRecommended algorithm:", as.character(pred), "\n")

  if (max_prob < CONF_THRESHOLD) {
    cat(sprintf("\n  [!] Low confidence (%.0f%% < threshold %.0f%%).\n",
                max_prob * 100, CONF_THRESHOLD * 100))
    cat("      Run all five algorithms and pick by usability score directly.\n")
    cat("      Collecting more diverse benchmark runs will improve confidence.\n")
  }

  cat("\nConfidence scores:\n")
  print(round(pred_probs, 3))

  invisible(list(algorithm = as.character(pred),
                 probabilities = pred_probs,
                 confident = max_prob >= CONF_THRESHOLD))
}


cat("=============================================================\n")
cat("  Training complete!  Key outputs:\n")
cat("  • decision_tree.png   — baseline model visualisation\n")
cat("  • feature_importance.png — which features matter most\n")
cat("  • usability_scores.png   — algorithm performance overview\n")
cat("  • per_class_f1.png       — honest per-class F1 scores  [NEW]\n")
cat("  • rf_model_v3.rds        — saved model\n")
cat("\n")
cat("  Primary metric is Macro-F1, not overall accuracy.\n")
cat("  Overall accuracy is misleading with imbalanced classes.\n")
cat("=============================================================\n")
