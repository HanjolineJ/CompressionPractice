# =============================================================================
# rawg_real_benchmark_pipeline.R
# Build real benchmark logs from RAWG records for ML_compression_model_v3.R
# =============================================================================

set.seed(42)

required_packages <- c("readr", "dplyr", "jsonlite", "digest")
for (pkg in required_packages) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    install.packages(pkg, repos = "https://cloud.r-project.org", quiet = TRUE)
  }
}

suppressPackageStartupMessages({
  library(readr)
  library(dplyr)
  library(jsonlite)
  library(digest)
})

# -----------------------------
# Config
# -----------------------------
RAWG_CSV_PATH <- "game_info.csv"
MAX_ROWS <- 500L
RAWG_OUT_DIR <- file.path("..", "DataToTest", "rawg_games")
LOGS_DIR <- file.path("..", "compressionaction", "logs")

TOOLS <- c("bzip2", "gzip", "lz4", "xz", "zstd")

# Optional level controls. Set NULL to use tool defaults.
TOOL_LEVEL <- list(
  bzip2 = "-9",
  gzip = "-9",
  lz4 = "-9",
  xz = "-9",
  zstd = "-19"
)

# -----------------------------
# Helpers
# -----------------------------
ensure_dir <- function(p) {
  if (!dir.exists(p)) dir.create(p, recursive = TRUE, showWarnings = FALSE)
}

sha256_file <- function(path) {
  digest::digest(file = path, algo = "sha256", serialize = FALSE)
}

which_tool <- function(name) {
  out <- suppressWarnings(system2("which", name, stdout = TRUE, stderr = FALSE))
  if (length(out) == 0) return(NA_character_)
  out[[1]]
}

safe_ms <- function(seconds) {
  round(as.numeric(seconds) * 1000, 3)
}

clamp_ratio <- function(src, dst) {
  if (is.na(src) || src <= 0 || is.na(dst) || dst < 0) return(0)
  r <- 1 - (dst / src)
  max(0, min(1, r))
}

compress_cmd <- function(tool, in_file, out_file) {
  lvl <- TOOL_LEVEL[[tool]]
  if (tool == "gzip") {
    args <- c("-c")
    if (!is.null(lvl)) args <- c(lvl, args)
    c(args, in_file)
  } else if (tool == "bzip2") {
    args <- c("-c")
    if (!is.null(lvl)) args <- c(lvl, args)
    c(args, in_file)
  } else if (tool == "xz") {
    args <- c("-c")
    if (!is.null(lvl)) args <- c(lvl, args)
    c(args, in_file)
  } else if (tool == "zstd") {
    args <- c("-q", "-c")
    if (!is.null(lvl)) args <- c(lvl, args)
    c(args, in_file)
  } else if (tool == "lz4") {
    args <- c("-q")
    if (!is.null(lvl)) args <- c(lvl, args)
    c(args, in_file, out_file)
  } else {
    character(0)
  }
}

decompress_cmd <- function(tool, compressed_file, restored_file) {
  if (tool == "gzip") {
    c("-dc", compressed_file)
  } else if (tool == "bzip2") {
    c("-dc", compressed_file)
  } else if (tool == "xz") {
    c("-dc", compressed_file)
  } else if (tool == "zstd") {
    c("-q", "-d", "-c", compressed_file)
  } else if (tool == "lz4") {
    c("-q", "-d", compressed_file, restored_file)
  } else {
    character(0)
  }
}

ext_for_tool <- function(tool) {
  if (tool == "gzip") return(".gz")
  if (tool == "bzip2") return(".bz2")
  if (tool == "xz") return(".xz")
  if (tool == "zstd") return(".zst")
  if (tool == "lz4") return(".lz4")
  ""
}

run_real_benchmark <- function(file_path, tool, tool_path, work_dir) {
  file_name <- basename(file_path)
  file_ext <- tolower(tools::file_ext(file_path))
  src_bytes <- as.numeric(file.info(file_path)$size)
  original_sha <- sha256_file(file_path)

  compressed <- file.path(work_dir, paste0(file_name, ext_for_tool(tool)))
  restored <- file.path(work_dir, paste0(file_name, ".restored"))

  if (is.na(tool_path) || !nzchar(tool_path)) {
    return(data.frame(
      tool = tool,
      src_bytes = src_bytes,
      dst_bytes = 0,
      ratio_saved = 0,
      compress_ms = 0,
      decompress_ms = 0,
      verified = "no",
      status = "tool_not_found",
      file_name = file_name,
      file_ext = file_ext,
      file_path = normalizePath(file_path),
      stringsAsFactors = FALSE
    ))
  }

  compress_start <- Sys.time()
  c_status <- 1

  if (tool == "lz4") {
    c_args <- compress_cmd(tool, file_path, compressed)
    c_status <- suppressWarnings(system2(tool_path, c_args, stdout = FALSE, stderr = FALSE))
  } else {
    c_args <- compress_cmd(tool, file_path, compressed)
    c_status <- suppressWarnings(system2(tool_path, c_args, stdout = compressed, stderr = FALSE))
  }

  compress_ms <- safe_ms(difftime(Sys.time(), compress_start, units = "secs"))

  if (!identical(c_status, 0L) || !file.exists(compressed)) {
    return(data.frame(
      tool = tool,
      src_bytes = src_bytes,
      dst_bytes = 0,
      ratio_saved = 0,
      compress_ms = compress_ms,
      decompress_ms = 0,
      verified = "no",
      status = "error",
      file_name = file_name,
      file_ext = file_ext,
      file_path = normalizePath(file_path),
      stringsAsFactors = FALSE
    ))
  }

  dst_bytes <- as.numeric(file.info(compressed)$size)

  decompress_start <- Sys.time()

  if (tool == "lz4") {
    d_args <- decompress_cmd(tool, compressed, restored)
    d_status <- suppressWarnings(system2(tool_path, d_args, stdout = FALSE, stderr = FALSE))
  } else {
    d_args <- decompress_cmd(tool, compressed, restored)
    d_status <- suppressWarnings(system2(tool_path, d_args, stdout = restored, stderr = FALSE))
  }

  decompress_ms <- safe_ms(difftime(Sys.time(), decompress_start, units = "secs"))

  verified <- "no"
  status <- "ok"

  if (!identical(d_status, 0L) || !file.exists(restored)) {
    status <- "error"
  } else {
    restored_sha <- sha256_file(restored)
    if (identical(restored_sha, original_sha)) {
      verified <- "yes"
    } else {
      status <- "hash_mismatch"
    }
  }

  if (file.exists(compressed)) file.remove(compressed)
  if (file.exists(restored)) file.remove(restored)

  data.frame(
    tool = tool,
    src_bytes = src_bytes,
    dst_bytes = dst_bytes,
    ratio_saved = round(clamp_ratio(src_bytes, dst_bytes), 4),
    compress_ms = compress_ms,
    decompress_ms = decompress_ms,
    verified = verified,
    status = status,
    file_name = file_name,
    file_ext = file_ext,
    file_path = normalizePath(file_path),
    stringsAsFactors = FALSE
  )
}

# -----------------------------
# Step 1: Load RAWG dataset
# -----------------------------
if (!file.exists(RAWG_CSV_PATH)) {
  stop("RAWG CSV not found at: ", RAWG_CSV_PATH,
       "\nDownload and unzip the Kaggle RAWG dataset so game_info.csv is in MLFirstTry/.")
}

games <- readr::read_csv(RAWG_CSV_PATH, show_col_types = FALSE)

games_clean <- games %>%
  filter(!is.na(name), !is.na(rating)) %>%
  select(id, name, released, rating, metacritic, genres, platforms, tags, playtime) %>%
  slice_head(n = MAX_ROWS)

cat("Loaded", nrow(games_clean), "RAWG rows\n")

# -----------------------------
# Step 2: Serialize records to files
# -----------------------------
ensure_dir(RAWG_OUT_DIR)

for (i in seq_len(nrow(games_clean))) {
  row <- games_clean[i, ]
  fp <- file.path(RAWG_OUT_DIR, paste0("game_", row$id, ".json"))
  jsonlite::write_json(row, fp, pretty = TRUE, auto_unbox = TRUE)
}

cat("Wrote", nrow(games_clean), "JSON files to", RAWG_OUT_DIR, "\n")

# -----------------------------
# Step 3: Real benchmark logs
# -----------------------------
ensure_dir(LOGS_DIR)
file_paths <- list.files(RAWG_OUT_DIR, pattern = "\\.json$", full.names = TRUE)

if (length(file_paths) == 0) {
  stop("No JSON files found in ", RAWG_OUT_DIR)
}

tool_paths <- setNames(vapply(TOOLS, which_tool, character(1)), TOOLS)
cat("Tool availability:\n")
for (t in TOOLS) {
  cat(" -", t, ":", ifelse(is.na(tool_paths[[t]]), "MISSING", tool_paths[[t]]), "\n")
}

work_dir <- tempfile(pattern = "rawg-bench-")
dir.create(work_dir, recursive = TRUE)
on.exit(unlink(work_dir, recursive = TRUE, force = TRUE), add = TRUE)

rows <- list()
idx <- 1L

for (fp in file_paths) {
  for (tool in TOOLS) {
    rows[[idx]] <- run_real_benchmark(fp, tool, tool_paths[[tool]], work_dir)
    idx <- idx + 1L
  }
}

all_benchmarks <- bind_rows(rows)

log_path <- file.path(LOGS_DIR, paste0("run_rawg_games_", as.integer(Sys.time()), ".csv"))
readr::write_csv(all_benchmarks, log_path)

cat("Benchmark log written to:", log_path, "\n")
cat("Rows:", nrow(all_benchmarks), "\n")
cat("Verified yes:", sum(all_benchmarks$verified == "yes"), "\n")
cat("Status counts:\n")
print(table(all_benchmarks$status))
cat("\nNext: Rscript ML_compression_model_v3.R\n")
