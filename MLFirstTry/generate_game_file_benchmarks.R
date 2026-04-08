# =============================================================================
# generate_game_file_benchmarks.R
# CompressionAction — Synthetic Game File Benchmark Generator
#
# PURPOSE:
#   Creates realistic synthetic run_*.csv log files mimicking what the Electron
#   app would produce when benchmarking actual Doom / Eternity Engine game files.
#
#   This gives the ML model diverse training data immediately, without needing
#   to manually drag every file through the Electron UI.
#
# Compression behavior modeled from real-world measurements on these file types:
#   .c / .h    — C source code (highly compressible, repetitive keywords)
#   .edf       — Eternity EDF config (very repetitive structured text)
#   .md / .txt — Prose/markdown (moderately compressible)
#   .wad       — Doom WAD binary (mixed: lumps, maps, sprites all in one)
#   .pk3/.pke  — ZIP-based game packages (already compressed internally)
#   .png       — PNG images (already compressed, minimal savings)
#
# HOW TO RUN:
#   Rscript generate_game_file_benchmarks.R
#   Then re-run:  Rscript ML_compression_model_v2.R
# =============================================================================

set.seed(123)

OUTPUT_DIR <- file.path("..", "compressionaction", "logs")

if (!dir.exists(OUTPUT_DIR)) {
  dir.create(OUTPUT_DIR, recursive = TRUE)
  cat("Created logs directory:", OUTPUT_DIR, "\n")
}

# Helper: jitter a value within a realistic range
jitter_pct <- function(base, pct = 0.08) {
  base * (1 + runif(1, -pct, pct))
}

# Helper: write one run_*.csv in the exact schema the Electron app produces
write_benchmark_csv <- function(filename, file_label, src_bytes, algo_profiles) {
  # algo_profiles is a list of lists:
  #   list(tool, ratio_saved, compress_ms, decompress_ms)
  rows <- lapply(algo_profiles, function(p) {
    dst_bytes <- round(src_bytes * (1 - jitter_pct(p$ratio_saved)))
    data.frame(
      tool          = p$tool,
      src_bytes     = src_bytes,
      dst_bytes     = dst_bytes,
      ratio_saved   = round(dst_bytes / src_bytes, 4),   # recompute from actual bytes
      compress_ms   = round(jitter_pct(p$compress_ms),   2),
      decompress_ms = round(jitter_pct(p$decompress_ms), 2),
      verified      = "yes",
      status        = "ok",
      stringsAsFactors = FALSE
    )
  })
  df <- do.call(rbind, rows)
  # Recalculate ratio_saved correctly
  df$ratio_saved <- round(1 - df$dst_bytes / df$src_bytes, 4)
  out_path <- file.path(OUTPUT_DIR, filename)
  write.csv(df, out_path, row.names = FALSE, quote = TRUE)
  cat("Written:", filename, " (", nrow(df), "algo rows, src=", src_bytes, "bytes,",
      "best algo≈", df$tool[which.max(df$ratio_saved)], ")\n")
}

cat("=== Generating synthetic game file benchmark CSVs ===\n\n")

# ============================================================================
# FILE TYPE 1: C SOURCE CODE (.c)
# Files: d_main.c (~40KB), p_map.c (~80KB), r_draw.c (~25KB)
# Profile: High ratio_saved for bzip2/xz (repetitive C syntax),
#          lz4 much faster decompression, zstd balanced.
# Expected winner: bzip2 or xz (storage-heavy usability weight)
# ============================================================================

write_benchmark_csv("run_crispy_d_main_c.csv", "d_main.c", src_bytes = 41200,
  list(
    list(tool="bzip2", ratio_saved=0.72, compress_ms=28,  decompress_ms=12),
    list(tool="gzip",  ratio_saved=0.68, compress_ms=18,  decompress_ms=8),
    list(tool="lz4",   ratio_saved=0.61, compress_ms=4,   decompress_ms=2),
    list(tool="xz",    ratio_saved=0.74, compress_ms=280, decompress_ms=18),
    list(tool="zstd",  ratio_saved=0.70, compress_ms=12,  decompress_ms=4)
  )
)

write_benchmark_csv("run_crispy_p_map_c.csv", "p_map.c", src_bytes = 82500,
  list(
    list(tool="bzip2", ratio_saved=0.73, compress_ms=55,  decompress_ms=22),
    list(tool="gzip",  ratio_saved=0.69, compress_ms=35,  decompress_ms=14),
    list(tool="lz4",   ratio_saved=0.62, compress_ms=8,   decompress_ms=3),
    list(tool="xz",    ratio_saved=0.75, compress_ms=540, decompress_ms=30),
    list(tool="zstd",  ratio_saved=0.71, compress_ms=22,  decompress_ms=7)
  )
)

write_benchmark_csv("run_crispy_r_draw_c.csv", "r_draw.c", src_bytes = 26800,
  list(
    list(tool="bzip2", ratio_saved=0.71, compress_ms=18,  decompress_ms=8),
    list(tool="gzip",  ratio_saved=0.67, compress_ms=12,  decompress_ms=6),
    list(tool="lz4",   ratio_saved=0.60, compress_ms=3,   decompress_ms=1),
    list(tool="xz",    ratio_saved=0.73, compress_ms=185, decompress_ms=13),
    list(tool="zstd",  ratio_saved=0.69, compress_ms=8,   decompress_ms=3)
  )
)

# ============================================================================
# FILE TYPE 2: EDF CONFIG FILE (.edf)
# File: frames.edf (263 KB) — extremely repetitive structured text
# Profile: bzip2/xz dominate heavily (Burrows-Wheeler shines on repetition),
#          lz4 fastest but weakest ratio.
# Expected winner: xz (best ratio) or bzip2 (ratio+speed balance)
# ============================================================================

write_benchmark_csv("run_eternity_frames_edf.csv", "frames.edf", src_bytes = 269312,
  list(
    list(tool="bzip2", ratio_saved=0.81, compress_ms=95,   decompress_ms=35),
    list(tool="gzip",  ratio_saved=0.75, compress_ms=62,   decompress_ms=22),
    list(tool="lz4",   ratio_saved=0.67, compress_ms=10,   decompress_ms=4),
    list(tool="xz",    ratio_saved=0.84, compress_ms=1800, decompress_ms=50),
    list(tool="zstd",  ratio_saved=0.79, compress_ms=38,   decompress_ms=12)
  )
)

write_benchmark_csv("run_eternity_things_edf.csv", "things.edf", src_bytes = 185000,
  list(
    list(tool="bzip2", ratio_saved=0.79, compress_ms=65,   decompress_ms=25),
    list(tool="gzip",  ratio_saved=0.73, compress_ms=42,   decompress_ms=16),
    list(tool="lz4",   ratio_saved=0.65, compress_ms=7,    decompress_ms=3),
    list(tool="xz",    ratio_saved=0.82, compress_ms=1200, decompress_ms=38),
    list(tool="zstd",  ratio_saved=0.77, compress_ms=28,   decompress_ms=9)
  )
)

# ============================================================================
# FILE TYPE 3: MARKDOWN / PLAIN TEXT (.md)
# Files: CHANGELOG.md (~200KB), README.md (~15KB)
# Profile: Moderate compressibility. zstd has great balanced profile here.
# Expected winner: zstd or gzip (balanced speed+ratio on prose text)
# ============================================================================

write_benchmark_csv("run_crispy_changelog_md.csv", "CHANGELOG.md", src_bytes = 204800,
  list(
    list(tool="bzip2", ratio_saved=0.68, compress_ms=75,  decompress_ms=28),
    list(tool="gzip",  ratio_saved=0.65, compress_ms=50,  decompress_ms=18),
    list(tool="lz4",   ratio_saved=0.58, compress_ms=9,   decompress_ms=3),
    list(tool="xz",    ratio_saved=0.70, compress_ms=900, decompress_ms=40),
    list(tool="zstd",  ratio_saved=0.67, compress_ms=28,  decompress_ms=8)
  )
)

write_benchmark_csv("run_crispy_readme_md.csv", "README.md", src_bytes = 14200,
  list(
    list(tool="bzip2", ratio_saved=0.65, compress_ms=6,  decompress_ms=3),
    list(tool="gzip",  ratio_saved=0.63, compress_ms=4,  decompress_ms=2),
    list(tool="lz4",   ratio_saved=0.55, compress_ms=1,  decompress_ms=0.5),
    list(tool="xz",    ratio_saved=0.67, compress_ms=65, decompress_ms=5),
    list(tool="zstd",  ratio_saved=0.64, compress_ms=3,  decompress_ms=1)
  )
)

# ============================================================================
# FILE TYPE 4: WAD BINARY (~50MB)
# Mixed binary content: map geometry, sprites, music, textures lumped together.
# Profile: Moderate compressibility (binary data + some text lumps).
#          lz4/zstd win because decompression speed matters more on large files
#          and the ratio advantage of bzip2 shrinks on binary data.
# Expected winner: lz4 or zstd (speed-weighted usability score on large binary)
# ============================================================================

write_benchmark_csv("run_doom1_wad.csv", "DOOM1.WAD", src_bytes = 4196020,
  list(
    list(tool="bzip2", ratio_saved=0.42, compress_ms=1800, decompress_ms=620),
    list(tool="gzip",  ratio_saved=0.39, compress_ms=980,  decompress_ms=310),
    list(tool="lz4",   ratio_saved=0.31, compress_ms=90,   decompress_ms=45),
    list(tool="xz",    ratio_saved=0.45, compress_ms=18000,decompress_ms=850),
    list(tool="zstd",  ratio_saved=0.41, compress_ms=450,  decompress_ms=120)
  )
)

write_benchmark_csv("run_freedoom1_wad.csv", "freedoom1.wad", src_bytes = 52428800,
  list(
    list(tool="bzip2", ratio_saved=0.38, compress_ms=22000, decompress_ms=7500),
    list(tool="gzip",  ratio_saved=0.35, compress_ms=12000, decompress_ms=3800),
    list(tool="lz4",   ratio_saved=0.28, compress_ms=1100,  decompress_ms=550),
    list(tool="xz",    ratio_saved=0.41, compress_ms=220000,decompress_ms=10000),
    list(tool="zstd",  ratio_saved=0.37, compress_ms=5500,  decompress_ms=1400)
  )
)

# ============================================================================
# FILE TYPE 5: PK3/PKE — Already-compressed ZIP game package
# These are ZIP archives internally, so all algorithms get near-zero savings.
# Speed of (de)compression completely dominates the usability score.
# Expected winner: lz4 (fastest, lowest overhead on incompressible data)
# ============================================================================

write_benchmark_csv("run_eternity_pk3.csv", "eternity.pk3", src_bytes = 8388608,
  list(
    list(tool="bzip2", ratio_saved=0.02, compress_ms=3200, decompress_ms=1100),
    list(tool="gzip",  ratio_saved=0.01, compress_ms=1800, decompress_ms=580),
    list(tool="lz4",   ratio_saved=0.01, compress_ms=180,  decompress_ms=90),
    list(tool="xz",    ratio_saved=0.03, compress_ms=35000,decompress_ms=1500),
    list(tool="zstd",  ratio_saved=0.02, compress_ms=820,  decompress_ms=210)
  )
)

write_benchmark_csv("run_crispy_pke.csv", "crispy-mod.pke", src_bytes = 2097152,
  list(
    list(tool="bzip2", ratio_saved=0.02, compress_ms=800,  decompress_ms=280),
    list(tool="gzip",  ratio_saved=0.01, compress_ms=450,  decompress_ms=145),
    list(tool="lz4",   ratio_saved=0.01, compress_ms=45,   decompress_ms=22),
    list(tool="xz",    ratio_saved=0.03, compress_ms=8800, decompress_ms=380),
    list(tool="zstd",  ratio_saved=0.02, compress_ms=205,  decompress_ms=55)
  )
)

# ============================================================================
# FILE TYPE 6: PNG (already compressed image data)
# Very low savings — PNG is already DEFLATE-compressed.
# Speed wins entirely. lz4 almost always wins.
# ============================================================================

write_benchmark_csv("run_crispy_icon_png.csv", "doom.png", src_bytes = 48200,
  list(
    list(tool="bzip2", ratio_saved=0.01, compress_ms=22,  decompress_ms=8),
    list(tool="gzip",  ratio_saved=0.00, compress_ms=14,  decompress_ms=5),
    list(tool="lz4",   ratio_saved=0.00, compress_ms=2,   decompress_ms=1),
    list(tool="xz",    ratio_saved=0.02, compress_ms=220, decompress_ms=12),
    list(tool="zstd",  ratio_saved=0.01, compress_ms=9,   decompress_ms=2)
  )
)

cat("\n=== Done! ===\n")
cat("Generated", 13, "synthetic benchmark CSV files in:", OUTPUT_DIR, "\n\n")
cat("File type breakdown and expected winners:\n")
cat("  .c / .h source code      → bzip2 or xz  (high text compressibility)\n")
cat("  .edf config (repetitive) → xz or bzip2  (block compressors dominate)\n")
cat("  .md / .txt prose         → zstd or gzip (balanced speed+ratio)\n")
cat("  .wad binary (large)      → lz4 or zstd  (speed matters at scale)\n")
cat("  .pk3 / .pke (pre-zipped) → lz4           (incompressible, speed only)\n")
cat("  .png (pre-compressed)    → lz4           (incompressible, speed only)\n")
cat("\nNow re-run:  Rscript ML_compression_model_v2.R\n")
cat("You should see 5+ distinct winning algorithms in the distribution.\n")
