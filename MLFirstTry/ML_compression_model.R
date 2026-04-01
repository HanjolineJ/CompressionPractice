# =============================================================================
# CompressionAction — Predictive Lossless Compression ML Framework
# Author : Hanjoline Julceus  |  Stetson University  |  Spring 2026
# Advisor: Dr. Subhankar Banerjee
#
# Purpose:
#   Phase 1 – Aggregate ALL benchmark CSV logs produced by the Electron app
#   Phase 2 – Engineer features (entropy proxy, usability score, file type)
#   Phase 3 – Train a Random Forest classifier  (upgrade from Decision Tree)
#   Phase 4 – Evaluate with Confusion Matrix + per-class metrics
#   Phase 5 – Predict the best algorithm for a NEW file from the command line
#
# How to run (from the MLFirstTry/ directory):
#   Rscript ML_compression_model.R
#
# VS Code tip: install the "R" extension (Yuki Ueda) and run line-by-line
#   with Ctrl+Enter, or run the whole file via the terminal above.
# =============================================================================


# ---- 0) Reproducibility seed ------------------------------------------------
set.seed(42)


# ---- 1) Package Bootstrap ---------------------------------------------------
# All packages are auto-installed if missing — no manual setup required.
required_packages <- c(
  "readr",          # fast CSV reading
  "dplyr",          # data wrangling verbs
  "tidyr",          # pivot helpers
  "caret",          # unified ML pipeline (train / confusionMatrix)
  "randomForest",   # Random Forest classifier
  "rpart",          # Decision Tree (kept for comparison baseline)
  "rpart.plot",     # Decision Tree visualisation
  "ggplot2"         # publication-quality plots
)

for (pkg in required_packages) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    message("Installing missing package: ", pkg)
    install.packages(pkg, repos = "https://cloud.r-project.org", quiet = TRUE)
  }
}

suppressPackageStartupMessages({
  library(readr)
  library(dplyr)
  library(tidyr)
  library(caret)
  library(randomForest)
  library(rpart)
  library(rpart.plot)
  library(ggplot2)
})

cat("=============================================================\n")
cat("  CompressionAction — ML Framework  (Spring 2026)\n")
cat("=============================================================\n\n")


# ---- 2) Aggregate All Benchmark Logs ----------------------------------------
# The Electron app writes one CSV per run into compressionaction/logs/.
# We load every run file and combine them so the model trains on as much
# real benchmark data as possible.

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

# Read each CSV and tag it with its source filename for traceability
raw_logs <- lapply(csv_files, function(f) {
  df <- tryCatch(
    read_csv(f, show_col_types = FALSE),
    error = function(e) NULL
  )
  if (!is.null(df)) df$log_file <- basename(f)
  df
})

# Drop any files that failed to parse, then bind everything into one frame
raw_logs <- Filter(Negate(is.null), raw_logs)
df_raw   <- bind_rows(raw_logs)

cat("Total rows loaded:", nrow(df_raw), "\n\n")


# ---- 3) Validate Schema -----------------------------------------------------
# The Electron app produces: tool, src_bytes, dst_bytes, ratio_saved,
# compress_ms, decompress_ms, verified, status
required_cols <- c("tool", "src_bytes", "dst_bytes", "ratio_saved",
                   "compress_ms", "decompress_ms", "verified", "status")

missing_cols <- setdiff(required_cols, names(df_raw))
if (length(missing_cols) > 0) {
  stop("CSV is missing expected columns: ", paste(missing_cols, collapse = ", "),
       "\nCheck that you are using the latest version of the Electron app.")
}


# ---- 4) Feature Engineering -------------------------------------------------
# Because the Electron app logs one row per (file × algorithm), we need to:
#   a) Compute per-file aggregate features (size, entropy proxy, file type)
#   b) Compute a Usability Score for each (file × algorithm) row
#   c) Label each file with its BEST algorithm (highest usability score)

# 4a — Keep only lossless-verified rows
df_valid <- df_raw %>%
  filter(tolower(verified) %in% c("yes", "true", "1"), tolower(status) == "ok")

if (nrow(df_valid) == 0) {
  stop("No verified/ok rows found after filtering. Check the 'verified' and 'status' columns.")
}

# 4b — Derive a file-type label from the log filename.
#   The log filename itself does not carry extension info, but src_bytes gives
#   us the file size tier — a simple but real feature your research plan uses.
#   We also add an "entropy proxy": ratio_saved is inversely related to entropy.
#   High ratio_saved  → low entropy → highly compressible.
#   Low  ratio_saved  → high entropy → already dense (e.g. pre-compressed GPU textures).

df_valid <- df_valid %>%
  mutate(
    # Compression ratio (compressed / original) — lower is better
    compression_ratio = dst_bytes / src_bytes,

    # Entropy proxy: 1 - ratio_saved maps high-savings → low entropy
    # This mirrors Shannon entropy without needing raw binary access in R.
    entropy_proxy = 1 - ratio_saved,

    # File size tier (matches research plan heuristics)
    size_tier = case_when(
      src_bytes < 10000          ~ "tiny",       # < 10 KB
      src_bytes < 1000000       ~ "small",      # 10 KB – 1 MB
      src_bytes < 100000000     ~ "medium",     # 1 MB – 100 MB
      TRUE                        ~ "large"        # > 100 MB
    ),

    # Usability Score — weighted formula from the research plan (Section 8):
    #   Storage Savings   35%
    #   Decompression Spd 35%  (inverted ms → normalised speed)
    #   Compression Spd   10%
    #   Memory proxy      20%  (approximated by compressed size ratio)
    #
    # We normalise each metric to [0, 1] within the current dataset so
    # scores are comparable across runs of very different file sizes.
    tool = as.character(tool)
  )

# Normalise per-file (group by log_file so we compare algorithms on same file)
df_valid <- df_valid %>%
  group_by(log_file) %>%
  mutate(
    # Higher ratio_saved is better → normalise so max = 1
    norm_savings      = (ratio_saved - min(ratio_saved)) /
                          (max(ratio_saved) - min(ratio_saved) + 1e-9),

    # Lower decomp_ms is better → invert then normalise
    norm_decomp_speed = 1 - (decompress_ms - min(decompress_ms)) /
                              (max(decompress_ms) - min(decompress_ms) + 1e-9),

    # Lower compress_ms is better → invert then normalise
    norm_comp_speed   = 1 - (compress_ms - min(compress_ms)) /
                              (max(compress_ms) - min(compress_ms) + 1e-9),

    # Lower compressed size → better memory profile → normalise inverted
    norm_memory       = 1 - (dst_bytes - min(dst_bytes)) /
                              (max(dst_bytes) - min(dst_bytes) + 1e-9),

    # Weighted usability score
    usability_score   = 0.35 * norm_savings +
                        0.35 * norm_decomp_speed +
                        0.10 * norm_comp_speed +
                        0.20 * norm_memory
  ) %>%
  ungroup()

# 4c — Label: for each log file, the algorithm with the highest usability score
df_best <- df_valid %>%
  group_by(log_file) %>%
  slice_max(order_by = usability_score, n = 1, with_ties = FALSE) %>%
  ungroup() %>%
  select(log_file, best_algorithm = tool)

# Merge the label back onto the full frame
df_model <- df_valid %>%
  inner_join(df_best, by = "log_file")

cat("--- Feature Engineering Complete ---\n")
cat("Rows in modelling dataset:", nrow(df_model), "\n")
cat("Unique benchmark runs:    ", n_distinct(df_model$log_file), "\n")
cat("Algorithms in dataset:    ", paste(sort(unique(df_model$tool)), collapse = ", "), "\n\n")

cat("Best algorithm distribution:\n")
print(table(df_best$best_algorithm))
cat("\n")


# ---- 5) Prepare Modelling Frame ---------------------------------------------
# One representative row per benchmark run (log_file) with aggregate features.
# We summarise across all algorithm rows to get file-level features.

df_per_file <- df_model %>%
  group_by(log_file, best_algorithm) %>%
  summarise(
    src_bytes       = first(src_bytes),
    size_tier       = first(size_tier),
    mean_savings    = mean(ratio_saved),        # avg compressibility across algos
    min_savings     = min(ratio_saved),         # worst-case compressibility
    max_savings     = max(ratio_saved),         # best-case compressibility
    spread_savings  = max(ratio_saved) - min(ratio_saved),  # how much algos differ
    entropy_proxy   = mean(entropy_proxy),      # avg entropy proxy
    mean_decomp_ms  = mean(decompress_ms),
    mean_comp_ms    = mean(compress_ms),
    bzip2_savings   = max(ifelse(tool == "bzip2",  ratio_saved, NA_real_), na.rm = TRUE),
    gzip_savings    = max(ifelse(tool == "gzip",   ratio_saved, NA_real_), na.rm = TRUE),
    lz4_savings     = max(ifelse(tool == "lz4",    ratio_saved, NA_real_), na.rm = TRUE),
    zstd_savings    = max(ifelse(tool == "zstd",   ratio_saved, NA_real_), na.rm = TRUE),
    .groups = "drop"
  ) %>%
  mutate(
    best_algorithm = as.factor(best_algorithm),
    size_tier      = as.factor(size_tier)
  )

# Replace any NaN/Inf from the per-algo savings columns
df_per_file <- df_per_file %>%
  mutate(across(where(is.numeric), ~ifelse(is.nan(.) | is.infinite(.), NA_real_, .)))

# Drop rows with NA in key features
df_per_file <- df_per_file %>% drop_na()

cat("Per-file modelling rows:", nrow(df_per_file), "\n\n")

if (nrow(df_per_file) < 5) {
  warning(
    "Very few training samples (", nrow(df_per_file), ").\n",
    "Run the Electron app on more files to improve model quality.\n",
    "The model will still train, but accuracy will be limited.\n"
  )
}


# ---- 6) Train / Test Split --------------------------------------------------
# 80% train, 20% test — stratified on best_algorithm so each class is
# represented in both splits even with a small dataset.

features <- c(
  "src_bytes", "size_tier",
  "mean_savings", "min_savings", "max_savings", "spread_savings",
  "entropy_proxy", "mean_decomp_ms", "mean_comp_ms",
  "bzip2_savings", "gzip_savings", "lz4_savings", "zstd_savings"
)
target   <- "best_algorithm"

# createDataPartition handles stratification automatically
if (nrow(df_per_file) >= 5) {
  train_idx  <- createDataPartition(df_per_file[[target]], p = 0.80, list = FALSE)
  train_data <- df_per_file[train_idx,  c(features, target)]
  test_data  <- df_per_file[-train_idx, c(features, target)]
} else {
  # Tiny dataset — train = test (just demonstrate the pipeline)
  train_data <- test_data <- df_per_file[, c(features, target)]
}

cat("Training samples:", nrow(train_data), "\n")
cat("Testing  samples:", nrow(test_data),  "\n\n")

num_classes <- dplyr::n_distinct(train_data[[target]])
single_class_mode <- num_classes < 2
single_class_label <- as.character(unique(train_data[[target]])[1])

if (single_class_mode) {
  warning(
    "Only one target class found in training data: '", single_class_label, "'.\n",
    "Skipping Decision Tree/Random Forest training.\n",
    "Collect more diverse benchmark runs so at least two algorithms are best",
    " on different files."
  )
}


# ---- 7a) Baseline: Decision Tree (rpart) ------------------------------------
cat("--- [Model 1] Decision Tree (Baseline) ---\n")

if (!single_class_mode) {
  dt_model <- rpart(
    as.formula(paste(target, "~", paste(features, collapse = " + "))),
    data   = train_data,
    method = "class"
  )

  dt_preds  <- predict(dt_model, newdata = test_data, type = "class")
  # Align factor levels to avoid confusionMatrix level mismatch
  dt_preds  <- factor(dt_preds,  levels = levels(test_data[[target]]))
  actuals   <- factor(test_data[[target]], levels = levels(test_data[[target]]))

  dt_cm     <- confusionMatrix(dt_preds, actuals)
  dt_acc    <- dt_cm$overall["Accuracy"]

  cat("Decision Tree Accuracy:", sprintf("%.1f%%", dt_acc * 100), "\n\n")
} else {
  dt_acc <- NA_real_
  actuals <- factor(test_data[[target]], levels = levels(test_data[[target]]))
  cat("Decision Tree Accuracy: N/A (single-class dataset)\n\n")
}


# ---- 7b) Upgrade: Random Forest ---------------------------------------------
# Random Forest = ensemble of many decision trees; more robust to small datasets,
# handles feature interactions, and gives feature importance rankings.
cat("--- [Model 2] Random Forest (Primary Model) ---\n")

# 5-fold cross-validation on the training set
if (!single_class_mode) {
  cv_control <- trainControl(
    method          = "cv",
    number          = 5,
    savePredictions = "final",
    classProbs      = TRUE
  )

  rf_model <- train(
    as.formula(paste(target, "~", paste(features, collapse = " + "))),
    data      = train_data,
    method    = "rf",
    trControl = cv_control,
    # ntree: number of trees; 500 is a good balance of accuracy vs. speed
    ntree     = 500,
    # mtry tuning: caret will try a few values automatically
    tuneLength = 3
  )

  rf_preds <- predict(rf_model, newdata = test_data)
  rf_preds <- factor(rf_preds, levels = levels(actuals))
  rf_cm    <- confusionMatrix(rf_preds, actuals)
  rf_acc   <- rf_cm$overall["Accuracy"]

  cat("Random Forest Accuracy:", sprintf("%.1f%%", rf_acc * 100), "\n\n")

  cat("--- Full Confusion Matrix (Random Forest) ---\n")
  print(rf_cm)
  cat("\n")
} else {
  rf_acc <- NA_real_
  cat("Random Forest Accuracy: N/A (single-class dataset)\n\n")
}


# ---- 8) Feature Importance --------------------------------------------------
cat("--- Feature Importance (Random Forest) ---\n")

if (!single_class_mode) {
  importance_df <- varImp(rf_model)$importance %>%
    as.data.frame() %>%
    tibble::rownames_to_column("feature") %>%
    arrange(desc(Overall)) %>%
    rename(importance = Overall)
} else {
  importance_df <- data.frame(
    feature = "single_class_dataset",
    importance = 1
  )
}

print(importance_df, digits = 3)
cat("\n")


# ---- 9) Accuracy Comparison Table -------------------------------------------
cat("--- Model Comparison ---\n")
comparison <- data.frame(
  Model    = c("Decision Tree (baseline)", "Random Forest (primary)"),
  Accuracy = c(
    ifelse(is.na(dt_acc), "N/A", sprintf("%.1f%%", dt_acc * 100)),
    ifelse(is.na(rf_acc), "N/A", sprintf("%.1f%%", rf_acc * 100))
  )
)
print(comparison, row.names = FALSE)
cat("\n")


# ---- 10) Visualisations -----------------------------------------------------
OUTPUT_DIR <- "."   # save plots next to this script inside MLFirstTry/

# 10a — Decision Tree plot
cat("Saving decision_tree.png ...\n")
png(file.path(OUTPUT_DIR, "decision_tree.png"), width = 1200, height = 700, res = 120)
if (!single_class_mode) {
  rpart.plot(dt_model,
             main      = "Baseline Decision Tree — Best Compression Algorithm",
             box.palette = "auto",
             shadow.col  = "gray")
} else {
  plot.new()
  text(0.5, 0.6, "Decision Tree Not Trained", cex = 1.5, font = 2)
  text(0.5, 0.5, paste("Only one class in data:", single_class_label), cex = 1.2)
  text(0.5, 0.4, "Collect more diverse files to enable classification.", cex = 1.0)
}
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

# 10c — Usability score comparison (all algorithms, all runs)
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
# Call this to predict the best algorithm for a new file based on its
# benchmark metrics (after you have run it through the Electron app once).
#
# Example:
#   predict_best_algorithm(
#     src_bytes     = 74796,
#     mean_savings  = 0.63,
#     mean_decomp_ms = 5.0
#   )

predict_best_algorithm <- function(
    src_bytes,
    mean_savings    = 0.60,
    min_savings     = 0.55,
    max_savings     = 0.65,
    spread_savings  = 0.10,
    mean_decomp_ms  = 10.0,
    mean_comp_ms    = 5.0,
    bzip2_savings   = 0.65,
    gzip_savings    = 0.60,
    lz4_savings     = 0.60,
    zstd_savings    = 0.62
) {
  # Derive entropy proxy and size tier from the provided values
  entropy_proxy <- 1 - mean_savings
  size_tier <- dplyr::case_when(
    src_bytes < 10000       ~ "tiny",
    src_bytes < 1000000     ~ "small",
    src_bytes < 100000000   ~ "medium",
    TRUE                    ~ "large"
  )
  size_tier <- factor(size_tier, levels = levels(train_data$size_tier))

  new_obs <- data.frame(
    src_bytes      = src_bytes,
    size_tier      = size_tier,
    mean_savings   = mean_savings,
    min_savings    = min_savings,
    max_savings    = max_savings,
    spread_savings = spread_savings,
    entropy_proxy  = entropy_proxy,
    mean_decomp_ms = mean_decomp_ms,
    mean_comp_ms   = mean_comp_ms,
    bzip2_savings  = bzip2_savings,
    gzip_savings   = gzip_savings,
    lz4_savings    = lz4_savings,
    zstd_savings   = zstd_savings
  )

  if (!single_class_mode) {
    pred       <- predict(rf_model, newdata = new_obs)
    pred_probs <- predict(rf_model, newdata = new_obs, type = "prob")
  } else {
    pred <- factor(single_class_label, levels = single_class_label)
    pred_probs <- data.frame(probability = 1.0)
    rownames(pred_probs) <- single_class_label
  }

  cat("\n--- Prediction for new file ---\n")
  cat("File size  :", formatC(src_bytes, format = "d", big.mark = ","), "bytes\n")
  cat("Size tier  :", as.character(size_tier), "\n")
  cat("Entropy proxy (1=max entropy):", round(entropy_proxy, 3), "\n")
  cat("\nRecommended algorithm:", as.character(pred), "\n")
  cat("Confidence scores:\n")
  print(round(pred_probs, 3))

  invisible(list(algorithm = as.character(pred), probabilities = pred_probs))
}

cat("=============================================================\n")
cat("  Training complete!  Key outputs:\n")
cat("  • decision_tree.png       — baseline model visualisation\n")
cat("  • feature_importance.png  — which features matter most\n")
cat("  • usability_scores.png    — algorithm performance overview\n")
cat("\n")
cat("  To predict the best algorithm for a new file, call:\n")
cat("  predict_best_algorithm(src_bytes = <file_size_in_bytes>)\n")
cat("=============================================================\n")