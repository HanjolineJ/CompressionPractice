# predict_cli.R
# ─────────────────────────────────────────────────────────────────────────────
# Called by Node.js to get a compression recommendation for a single file.
# Node spawns:  Rscript predict_cli.R <json_args>
# This script prints ONE line of JSON to stdout, nothing else.
#
# Input JSON fields (all optional except src_bytes):
#   src_bytes       integer  file size in bytes
#   file_ext        string   extension without dot, e.g. "json"
#   shannon_entropy number   bits/byte (0-8), computed by Node before calling
#   mean_savings    number   average ratio_saved across quick probe runs (0-1)
#   mean_decomp_ms  number   average decompression time from probe
#   mean_comp_ms    number   average compression time from probe
#
# Output JSON fields:
#   algorithm   string   recommended algorithm name
#   confidence  number   0-1 probability of the top prediction
#   confident   boolean  true if confidence >= 0.40 threshold
#   scores      object   { bzip2: 0.12, gzip: 0.05, lz4: 0.38, xz: 0.21, zstd: 0.24 }
#   error       string   only present if something went wrong
# ─────────────────────────────────────────────────────────────────────────────

# Silence all package startup messages — Node only reads stdout
suppressPackageStartupMessages({
  library(jsonlite)
  library(randomForest)
  library(dplyr)
})

emit <- function(obj) {
  cat(toJSON(obj, auto_unbox = TRUE), "\n")
  quit(status = 0, save = "no")
}

emit_error <- function(msg) {
  emit(list(error = msg))
}

# Null-coalescing helper — must be defined before first use
`%||%` <- function(a, b) if (!is.null(a) && length(a) > 0 && !is.na(a[1])) a else b

# ── 1. Parse arguments ────────────────────────────────────────────────────────
args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1) {
  emit_error("No arguments provided. Expected JSON string as first argument.")
}

params <- tryCatch(
  fromJSON(args[1]),
  error = function(e) NULL
)
if (is.null(params)) {
  emit_error(paste("Could not parse input JSON:", args[1]))
}

src_bytes <- as.numeric(params$src_bytes %||% 0)
if (src_bytes <= 0) {
  emit_error("src_bytes must be a positive number.")
}

file_ext        <- as.character(params$file_ext        %||% "unknown")
shannon_entropy <- as.numeric( params$shannon_entropy  %||% NA_real_)
mean_savings    <- as.numeric( params$mean_savings     %||% 0.60)
min_savings     <- as.numeric( params$min_savings      %||% 0.55)
max_savings     <- as.numeric( params$max_savings      %||% 0.65)
spread_savings  <- as.numeric( params$spread_savings   %||% 0.10)
mean_decomp_ms  <- as.numeric( params$mean_decomp_ms   %||% 10.0)
mean_comp_ms    <- as.numeric( params$mean_comp_ms     %||% 5.0)
bzip2_savings   <- as.numeric( params$bzip2_savings    %||% mean_savings)
gzip_savings    <- as.numeric( params$gzip_savings     %||% mean_savings)
lz4_savings     <- as.numeric( params$lz4_savings      %||% mean_savings)
xz_savings      <- as.numeric( params$xz_savings       %||% mean_savings)
zstd_savings    <- as.numeric( params$zstd_savings     %||% mean_savings)

if (is.na(shannon_entropy)) shannon_entropy <- NA_real_
if (is.na(mean_savings))    mean_savings    <- 0.60

# ── 2. Load the saved model bundle ───────────────────────────────────────────
# Locate rf_model_v3.rds relative to this script using commandArgs.
# sys.frame(1)$ofile does not work when called from Rscript on the command line.
script_path  <- normalizePath(commandArgs(trailingOnly = FALSE) |>
                  Filter(f = function(x) startsWith(x, "--file="), x = _) |>
                  (\(x) if (length(x)) sub("--file=", "", x[1]) else "predict_cli.R")(),
                mustWork = FALSE, winslash = "/")
script_dir   <- dirname(script_path)
model_path   <- file.path(script_dir, "rf_model_v3.rds")

if (!file.exists(model_path)) {
  emit_error(paste("Model file not found:", model_path,
                   "— run ML_compression_model_v3.R first to train and save the model."))
}

bundle <- tryCatch(
  readRDS(model_path),
  error = function(e) NULL
)
if (is.null(bundle) || is.null(bundle$rf_model)) {
  emit_error("Failed to load rf_model_v3.rds — the file may be corrupt or from an older version.")
}

# ── 3. Build the observation data frame ──────────────────────────────────────
SIZE_TIER_LEVELS <- c("tiny", "small", "medium", "large")
CONF_THRESHOLD   <- 0.40

size_tier_val <- dplyr::case_when(
  src_bytes < 10000     ~ "tiny",
  src_bytes < 1000000   ~ "small",
  src_bytes < 100000000 ~ "medium",
  TRUE                  ~ "large"
)
size_tier <- factor(size_tier_val, levels = bundle$size_tier_lvls %||% SIZE_TIER_LEVELS)

safe_ext   <- if (!is.null(bundle$file_ext_lvls) && file_ext %in% bundle$file_ext_lvls) file_ext else "unknown"
file_ext_f <- factor(safe_ext, levels = bundle$file_ext_lvls %||% "unknown")

new_obs <- data.frame(
  src_bytes       = src_bytes,
  size_tier       = size_tier,
  file_ext        = file_ext_f,
  mean_savings    = mean_savings,
  min_savings     = min_savings,
  max_savings     = max_savings,
  spread_savings  = spread_savings,
  mean_decomp_ms  = mean_decomp_ms,
  mean_comp_ms    = mean_comp_ms,
  bzip2_savings   = bzip2_savings,
  gzip_savings    = gzip_savings,
  lz4_savings     = lz4_savings,
  xz_savings      = xz_savings,
  zstd_savings    = zstd_savings,
  shannon_entropy = shannon_entropy,
  stringsAsFactors = FALSE
)

# Only pass in features the model was actually trained on
active_features <- bundle$model_features %||% names(new_obs)
keep_cols       <- intersect(active_features, names(new_obs))
new_obs         <- new_obs[, keep_cols, drop = FALSE]

# ── 4. Predict ────────────────────────────────────────────────────────────────
result <- tryCatch({
  pred       <- predict(bundle$rf_model, newdata = new_obs)
  pred_probs <- predict(bundle$rf_model, newdata = new_obs, type = "prob")

  algo       <- as.character(pred)
  probs_vec  <- as.numeric(pred_probs[1, ])
  names(probs_vec) <- colnames(pred_probs)
  confidence <- max(probs_vec)

  list(
    algorithm  = algo,
    confidence = round(confidence, 3),
    confident  = confidence >= CONF_THRESHOLD,
    scores     = as.list(round(probs_vec, 3))
  )
}, error = function(e) {
  list(error = paste("Prediction failed:", conditionMessage(e)))
})

emit(result)