# ---- 1) Package setup ----
suppressPackageStartupMessages({
  if (!requireNamespace("readr", quietly = TRUE)) {
    stop("Package 'readr' is required. Install with: Rscript -e \"install.packages('readr', repos='https://cloud.r-project.org')\"")
  }
  library(readr)
})

`%||%` <- function(a, b) {
  if (!is.null(a) && nzchar(a)) a else b
}

# ---- 2) Locate CSV ----
args <- commandArgs(trailingOnly = FALSE)
file_arg <- grep("^--file=", args, value = TRUE)

if (length(file_arg) > 0) {
  script_path <- sub("^--file=", "", file_arg[1])
  script_dir <- dirname(normalizePath(script_path, mustWork = FALSE))
} else {
  script_dir <- getwd()
}

candidate_paths <- c(
  file.path(script_dir, "your_dataset.csv"),
  file.path(script_dir, "vgsales.csv"),
  file.path(script_dir, "video_game_sales.csv"),
  file.path(script_dir, "dataset.csv")
)

existing_candidates <- candidate_paths[file.exists(candidate_paths)]

if (length(existing_candidates) == 0) {
  csv_files <- list.files(script_dir, pattern = "\\.csv$", full.names = TRUE, ignore.case = TRUE)
  if (length(csv_files) == 0) {
    stop(paste0("No CSV found in ", script_dir, ". Put your dataset there or edit candidate_paths."))
  }
  csv_path <- csv_files[1]
} else {
  csv_path <- existing_candidates[1]
}

cat("Using CSV:", csv_path, "\n")
df <- read_csv(csv_path, show_col_types = FALSE)

# ---- 3) Choose target column ----
preferred_targets <- c("Global_Sales", "global_sales", "Sales", "sales", "Y")
found_targets <- preferred_targets[preferred_targets %in% names(df)]

if (length(found_targets) > 0) {
  target_col <- found_targets[1]
} else {
  numeric_cols <- names(df)[sapply(df, is.numeric)]
  if (length(numeric_cols) == 0) {
    stop("No numeric target candidate found. Please add a numeric sales/target column.")
  }
  target_col <- numeric_cols[length(numeric_cols)]
  warning(paste("Target column not found by name; using numeric column:", target_col))
}

cat("Target column:", target_col, "\n")

# ---- 4) Basic cleanup ----
df <- df[!is.na(df[[target_col]]), ]

char_cols <- names(df)[sapply(df, is.character)]
for (column_name in char_cols) {
  df[[column_name]] <- as.factor(df[[column_name]])
}

# Remove columns with all NAs to avoid model issues
all_na_cols <- names(df)[colSums(is.na(df)) == nrow(df)]
if (length(all_na_cols) > 0) {
  df <- df[, setdiff(names(df), all_na_cols), drop = FALSE]
}

if (nrow(df) < 10) {
  stop("Dataset is too small after cleanup (<10 rows).")
}

# ---- 5) Train/test split (base R) ----
set.seed(42)
idx <- sample(seq_len(nrow(df)), size = floor(0.8 * nrow(df)))
train_df <- df[idx, , drop = FALSE]
test_df <- df[-idx, , drop = FALSE]

if (nrow(test_df) == 0) {
  stop("Test split is empty. Need more rows in dataset.")
}

# ---- 6) Baseline model ----
formula_txt <- paste(target_col, "~ .")
baseline_model <- lm(as.formula(formula_txt), data = train_df)

# ---- 7) Evaluate ----
pred <- predict(baseline_model, newdata = test_df)
actual <- test_df[[target_col]]

rmse <- sqrt(mean((pred - actual) ^ 2, na.rm = TRUE))
mae <- mean(abs(pred - actual), na.rm = TRUE)

cat("\nBaseline Results\n")
cat("Rows:", nrow(df), "\n")
cat("Columns:", ncol(df), "\n")
cat("RMSE:", rmse, "\n")
cat("MAE :", mae, "\n")