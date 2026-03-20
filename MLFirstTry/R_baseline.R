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
# The agent has identified the most recent benchmark run.
# If you want to use a different file, change the path here.
csv_path <- file.path("..", "compressionaction", "logs", "run_1763564918695.csv")

if (!file.exists(csv_path)) {
  stop(paste("Specified CSV file not found at:", csv_path))
}

cat("Using benchmark data:", csv_path, "\n")
df <- read_csv(csv_path, show_col_types = FALSE)

# ---- 3) Feature Engineering: Determine the best algorithm ----
# For each file, find the algorithm with the highest usability_score.
# This will be our target variable for classification.
df_best <- df %>%
  filter(lossless_valid == TRUE) %>%
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
train_files_idx <- createDataPartition(unique_files, p = 0.8, list = FALSE)
train_files <- unique_files[train_files_idx]

train_df <- df[df$file_path %in% train_files, ]
test_df <- df[!df$file_path %in% train_files, ]

if (nrow(train_df) == 0 || nrow(test_df) == 0) {
  stop("Train or test split is empty. Need more diverse data.")
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