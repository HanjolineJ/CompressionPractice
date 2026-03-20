# Copilot Instructions for CompressionAction ML Research (R)

## Project Context
This project is a research-driven machine learning system for predictive lossless compression of game and software asset files.

The goal is to build an R-based model that:
- extracts measurable file features
- classifies asset types
- predicts the best lossless compression algorithm and settings
- estimates compression ratio, compression time, decompression speed, and memory usage
- recommends the best algorithm based on a weighted "lossless usability" score

This repository supports research into intelligent archival and runtime compression decisions for files such as executables, textures, shaders, audio, maps, packages, and engine assets.

---

## Core Research Objective
Whenever generating code, explanations, or refactors, optimize for this workflow:

1. **Extract file metadata and binary-derived features**
   - file size
   - extension
   - magic number / file signature
   - entropy
   - byte histogram statistics
   - zero-byte ratio
   - repetition score
   - run-length patterns
   - chunk similarity
   - asset type classification
   - compression/decompression benchmark metrics

2. **Build ML models in R**
   - classification model to predict the best algorithm family
   - regression models to predict numeric outcomes like compression ratio and decompression time
   - ranking or score-based selection for final recommendation

3. **Evaluate algorithms**
   - gzip
   - bzip2
   - xz
   - zstd
   - lz4
   - optionally brotli and snappy if added later

4. **Verify lossless validity**
   - every compression result must be validated with SHA-256 hash equality after decompression
   - any failed round-trip must be treated as invalid and scored as zero

---

## Language and Tooling Rules
- Prefer **R** for all data science, feature engineering, training, evaluation, and reporting code.
- Use clean, modular, reproducible R scripts.
- Use:
  - `tidyverse` for data wrangling
  - `data.table` when performance matters
  - `readr` for CSV I/O
  - `stringr` for parsing
  - `purrr` for iteration
  - `digest` for SHA-256 hashing
  - `caret`, `tidymodels`, `rpart`, `randomForest`, or `xgboost` for ML
  - `ggplot2` for visualization
- Prefer `tidymodels` or `caret` for standardized ML workflows when appropriate.
- Write code that is easy for a fourth-year CS student to explain in a research paper and presentation.

---

## Modeling Requirements
When suggesting models, default to this structure unless the repository already defines a different one:

### Classification targets
Predict:
- best compression algorithm
- optional best compression level / setting bucket

### Regression targets
Predict:
- compression ratio
- compression time
- decompression throughput
- memory usage
- latency

### Scoring
Use a weighted usability score:

- Storage Savings: 35%
- Decompression Speed: 35%
- Memory Usage: 20%
- Compression Speed: 10%

If SHA-256 verification fails after decompression, set usability score to **0**.

---

## Feature Engineering Standards
Always try to generate features from the file itself before modeling. Favor measurable features over guesses.

### Required features
- file name
- extension
- file size in bytes
- file size in MB/GB
- nominal format
- detected format from magic number
- asset class:
  - executable
  - package/container
  - texture/visual
  - audio
  - shader
  - script/text
  - map/level/save
  - unknown

### Statistical/binary features
- Shannon entropy
- unique byte count
- byte frequency histogram summaries
- zero-byte ratio
- repeated byte-sequence score
- average run length
- chunk similarity features
- ASCII/text-likeness score if relevant

### Benchmark-derived features
- original size
- compressed size
- compression ratio
- compression time
- decompression time
- MB/s throughput
- hash verification result

---

## File Handling Standards
- Always process binary files safely.
- Prefer chunked reading for large files.
- Avoid loading very large files entirely into memory unless necessary.
- Clearly separate:
  - metadata extraction
  - binary feature extraction
  - benchmark execution
  - ML preprocessing
  - training
  - evaluation
  - reporting

- For unknown or ambiguous extensions like `.bin`, prefer magic-number detection and measured statistics over file extension assumptions.

---

## Compression Benchmarking Rules
Whenever generating benchmark code:
- benchmark multiple algorithms on the same file
- collect both ratio and time metrics
- record failures explicitly
- verify decompressed output with SHA-256
- save results in a structured tabular format suitable for R training pipelines

Preferred output columns:
- file_path
- extension
- detected_type
- file_size_bytes
- algorithm
- level
- compressed_size_bytes
- compression_ratio
- compression_time_sec
- decompression_time_sec
- decompression_mbps
- sha256_original
- sha256_restored
- lossless_valid
- usability_score

---

## Evaluation Standards
When generating model evaluation code, prefer:
- train/validation/test split
- cross-validation where reasonable
- confusion matrix for classification
- Top-1 accuracy
- Top-2 accuracy
- MAE / RMSE for regression
- ranking quality if multiple algorithms are compared
- feature importance plots
- error analysis by file type and asset class

Always report results in a form suitable for a research report.

---

## Code Style
- Write compact, readable, well-commented R code.
- Use descriptive variable names.
- Avoid unnecessary abstraction.
- Prefer functions with clear inputs and outputs.
- Include short comments explaining the research purpose of each step.
- When writing long scripts, organize them into sections with clear headers.

Example section headers:
- Load Libraries
- Read Benchmark Data
- Clean and Encode Features
- Train Classification Model
- Train Regression Model
- Score Algorithms
- Evaluate Performance
- Save Outputs

---

## Documentation Style
When writing comments, READMEs, or notebook text:
- explain why the step matters for predictive compression
- connect implementation choices back to research goals
- use precise technical language, but keep it understandable
- highlight tradeoffs between compression ratio, decompression speed, and memory use

---

## Copilot Response Preferences
When assisting in this repository, Copilot should:
- prefer R examples over Python unless the task is specifically about external extraction tooling
- produce complete functions, not fragments
- include edge-case handling
- preserve reproducibility
- avoid fake data unless explicitly asked
- assume the end goal is publication-quality research code
- favor solutions that can be defended in a senior research presentation

---

## Research-Specific Guidance
Keep the project aligned with this thesis direction:

A machine learning model should evaluate a file based on measurable structure and benchmark behavior, then recommend the most appropriate lossless compression method for storage and usability.

The system should help answer questions such as:
- Which algorithm is best for this file type?
- Which algorithm gives the best balance of ratio and speed?
- Which files are likely already pre-compressed?
- Which measurable features best predict compression success?
- Can asset-aware modeling outperform generic archive defaults?

---

## What to Avoid
- Do not suggest lossy compression unless explicitly requested.
- Do not assume file extension alone is reliable.
- Do not skip SHA-256 validation.
- Do not optimize only for smallest size if decompression speed becomes impractical.
- Do not produce black-box code without explaining the feature pipeline.

---

## Preferred First Models
If asked to build a baseline quickly, start with:
- Decision Tree (`rpart`)
- Random Forest
- Multinomial classification model if appropriate
- Simple regression model for ratio/time prediction

If asked to improve performance later, consider:
- XGBoost
- stacked models
- nearest-neighbor ranking approach
- feature selection workflows

---

## Deliverable Bias
Prioritize outputs that help the research move forward:
- clean CSV datasets
- reproducible R scripts
- benchmark summaries
- feature importance analysis
- tables for paper inclusion
- plots for poster/slides
- interpretable model outputs