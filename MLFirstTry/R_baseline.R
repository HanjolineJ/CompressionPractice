# ---- 1) Package setup ----
suppressPackageStartupMessages({
  # Define required packages
  required_packages <- c("readr", "dplyr", "caret", "rpart", "rpart.plot")

  # Check and install missing packages
  for (pkg in required_packages) {
    if (!requireNamespace(pkg, quietly = TRUE)) {
      cat("Installing package:", pkg, "\n")
      install.packages(pkg, repos = "https://cloud.r-project.org")
    }
  }
  
  # Load packages
  library(readr)
  library(dplyr)
  library(caret)
  library(rpart)
  library(rpart.plot)
})

# ---- 2) Locate and load data ----
# Load all benchmark runs so the baseline has enough diversity.
logs_dir <- file.path("..", "compressionaction", "logs")

if (!dir.exists(logs_dir)) {
  stop("Logs directory not found: ", logs_dir)
}

csv_paths <- list.files(
  logs_dir,
  pattern = "^run_.*\\.csv$",
  full.names = TRUE
)

if (length(csv_paths) == 0) {
  stop("No benchmark CSV files found in: ", logs_dir)
}

cat("Found", length(csv_paths), "benchmark log file(s). Loading...\n")

raw_list <- lapply(csv_paths, function(p) {
  tryCatch({
    read_csv(p, show_col_types = FALSE) %>%
      mutate(log_file = basename(p))
  }, error = function(e) {
    warning("Skipping unreadable file: ", p, " (", e$message, ")")
    NULL
  })
})

raw_list <- Filter(Negate(is.null), raw_list)
if (length(raw_list) == 0) {
  stop("All log files failed to load.")
}

df <- bind_rows(raw_list)
cat("Total rows loaded:", nrow(df), "\n")

to_logical <- function(x) {
  if (is.logical(x)) return(x)
  v <- tolower(trimws(as.character(x)))
  v %in% c("true", "1", "yes", "y", "ok")
}

scale01 <- function(x) {
  if (all(is.na(x))) return(rep(NA_real_, length(x)))
  rng <- range(x, na.rm = TRUE)
  if (!is.finite(rng[1]) || !is.finite(rng[2]) || (rng[2] - rng[1]) == 0) {
    return(rep(0, length(x)))
  }
  (x - rng[1]) / (rng[2] - rng[1])
}

# Standardize schema across old/new CSV formats.
df <- df %>%
  mutate(
    algorithm = dplyr::coalesce(
      if ("algorithm" %in% names(.)) as.character(algorithm) else NA_character_,
      if ("tool" %in% names(.)) as.character(tool) else NA_character_
    ),
    file_path = dplyr::coalesce(
      if ("file_path" %in% names(.)) as.character(file_path) else NA_character_,
      as.character(log_file)
    ),
    file_size_bytes = dplyr::coalesce(
      if ("file_size_bytes" %in% names(.)) as.numeric(file_size_bytes) else NA_real_,
      if ("src_bytes" %in% names(.)) as.numeric(src_bytes) else NA_real_
    ),
    dst_bytes_std = dplyr::coalesce(
      if ("dst_bytes" %in% names(.)) as.numeric(dst_bytes) else NA_real_,
      if ("compressed_size_bytes" %in% names(.)) as.numeric(compressed_size_bytes) else NA_real_
    ),
    ratio_saved_std = dplyr::coalesce(
      if ("ratio_saved" %in% names(.)) as.numeric(ratio_saved) else NA_real_,
      if ("compression_ratio" %in% names(.)) 1 - as.numeric(compression_ratio) else NA_real_
    ),
    compress_ms_std = dplyr::coalesce(
      if ("compress_ms" %in% names(.)) as.numeric(compress_ms) else NA_real_,
      if ("compression_time_sec" %in% names(.)) as.numeric(compression_time_sec) * 1000 else NA_real_
    ),
    decompress_ms_std = dplyr::coalesce(
      if ("decompress_ms" %in% names(.)) as.numeric(decompress_ms) else NA_real_,
      if ("decompression_time_sec" %in% names(.)) as.numeric(decompression_time_sec) * 1000 else NA_real_
    ),
    lossless_valid = dplyr::coalesce(
      if ("lossless_valid" %in% names(.)) to_logical(lossless_valid) else NA,
      if ("verified" %in% names(.)) to_logical(verified) else NA,
      TRUE
    ),
    extension = dplyr::coalesce(
      if ("extension" %in% names(.)) as.character(extension) else NA_character_,
      ifelse(grepl("\\.", file_path), sub("^.*\\.", "", file_path), "unknown")
    )
  )

# ---- 3) Feature Engineering: Determine the best algorithm ----
# Build usability_score if not already present.
if (!("usability_score" %in% names(df))) {
  df$usability_score <- NA_real_
}

df <- df %>%
  group_by(file_path) %>%
  mutate(
    norm_savings = scale01(ratio_saved_std),
    norm_decomp_speed = 1 - scale01(decompress_ms_std),
    norm_comp_speed = 1 - scale01(compress_ms_std),
    norm_memory = 1 - scale01(dst_bytes_std),
    computed_usability = 0.35 * norm_savings +
      0.35 * norm_decomp_speed +
      0.10 * norm_comp_speed +
      0.20 * norm_memory,
    usability_score = dplyr::coalesce(as.numeric(usability_score), computed_usability, 0)
  ) %>%
  ungroup()

# For each file, find the algorithm with the highest usability_score.
df_best <- df %>%
  filter(lossless_valid == TRUE, !is.na(algorithm), !is.na(usability_score)) %>%
  group_by(file_path) %>%
  slice_max(order_by = usability_score, n = 1, with_ties = FALSE) %>%
  ungroup() %>%
  select(file_path, best_algorithm = algorithm)

# Join the target variable back to the main dataframe
df <- df %>%
  inner_join(df_best, by = "file_path")

# Convert character columns to factors for the model
df <- df %>%
  mutate(
    algorithm = as.factor(algorithm),
    best_algorithm = as.factor(best_algorithm),
    extension = as.factor(extension)
  )

# ---- 4) Select features and target ----
# Per instructions, we predict the best algorithm based on file features.
features <- c("file_size_bytes", "extension")
target_col <- "best_algorithm"

# Ensure required columns exist
model_cols <- c(features, target_col)
if (!all(model_cols %in% names(df))) {
  stop("Dataset is missing required columns for modeling. Need: ", paste(model_cols, collapse=", "))
}

# ---- 5) Train/test split ----
set.seed(42)
# We need to ensure the split is done on a per-file basis, not per-row.
unique_files <- unique(df$file_path)
if (length(unique_files) < 2) {
  stop("Need at least two files/runs to create train and test sets.")
}

train_n <- max(1, floor(0.8 * length(unique_files)))
if (train_n >= length(unique_files)) {
  train_n <- length(unique_files) - 1
}
train_files <- sample(unique_files, size = train_n)

train_df <- df[df$file_path %in% train_files, ]
test_df <- df[!df$file_path %in% train_files, ]

if (nrow(train_df) == 0 || nrow(test_df) == 0) {
  stop("Train or test split is empty. Need more diverse data.")
}

if (dplyr::n_distinct(train_df[[target_col]]) < 2) {
  cat("\nOnly one class found in training data:", as.character(unique(train_df[[target_col]])[1]), "\n")
  cat("Need more diverse benchmark runs where different algorithms win per file.\n")
  quit(save = "no", status = 0)
}

cat("Training data rows:", nrow(train_df), "\n")
cat("Testing data rows:", nrow(test_df), "\n")

# ---- 6) Train a Decision Tree Model ----
# Using rpart as recommended for a baseline model.
formula_txt <- paste(target_col, "~", paste(features, collapse = " + "))
cat("Using formula:", formula_txt, "\n")

# We train on the full training set to predict the single best algorithm.
# Note: We are training on all algorithm records, not just the "best" ones,
# so the model learns the properties of each.
model <- rpart(
  as.formula(formula_txt),
  data = train_df,
  method = "class"
)

# ---- 7) Evaluate Model ----
# Predict the best algorithm for the test set files
# Note: We only need to predict once per file, so we use a distinct subset of the test data.
test_files_df <- test_df %>% distinct(file_path, .keep_all = TRUE)
predictions <- predict(model, newdata = test_files_df, type = "class")

# Get the actual best algorithm for the test set
actuals <- test_files_df[[target_col]]

# Calculate accuracy
confusion_matrix <- confusionMatrix(predictions, actuals)
accuracy <- confusion_matrix$overall['Accuracy']

cat("\n--- Model Evaluation ---\n")
cat("Model: Decision Tree (rpart)\n")
cat("Accuracy on test set:", sprintf("%.2f%%", accuracy * 100), "\n\n")

print(confusion_matrix)

# ---- 8) Visualize the Decision Tree ----
cat("\n--- Visualizing Model ---\n")
# Plot the tree to understand its logic
# This helps interpret how it makes decisions based on features.
png("decision_tree.png", width = 1000, height = 600)
rpart.plot(model, main = "Decision Tree for Best Compression Algorithm", box.palette = "auto")
dev.off()
cat("Saved decision tree visualization to decision_tree.png\n")