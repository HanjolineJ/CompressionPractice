# CompressionPractice

A machine-learning-driven research project that benchmarks lossless compression algorithms (gzip, bzip2, xz, zstd, lz4) on game and software asset files, then uses an R-based ML model to predict the best algorithm for a given file.

---

## Project Structure

```
CompressionPractice/
├── script.py                  # Python standalone benchmark script
├── sample_files.txt           # Sample input file
├── GameAsset.txt              # Game asset input file
├── LargeDataset.txt           # Large dataset input file
├── compressionaction/         # Electron + Vite desktop application
│   ├── package.json
│   ├── requirements.txt       # Python deps for graph generation
│   ├── src/
│   │   ├── backend/           # Node.js compression runners & graph generators
│   │   └── renderer/          # React UI (App.jsx)
│   └── electron/              # Electron main process
└── MLFirstTry/
    └── R_baseline.R           # R ML baseline model (Decision Tree)
```

---

## Part 1 – Python Benchmark Script (`script.py`)

The standalone Python script compresses `GameAsset.txt`, `LargeDataset.txt`, and `sample_files.txt` with every algorithm and prints a comparison table with SHA-256 round-trip verification.

### Prerequisites

```bash
# Install system compressors (only needed once)
# macOS
brew install gzip bzip2 xz zstd lz4

# Ubuntu / Debian
sudo apt-get install -y gzip bzip2 xz-utils zstd lz4

# Install Python dependencies (only needed once)
pip install psutil zstandard lz4
```

### Run

```bash
# From the project root
python script.py
```

Compressed files are written to a `.venv/` directory in the project root.  
Output shows each algorithm's compressed size, space saved (%), time, and verification status (`PASS`/`FAIL`).

---

## Part 2 – Electron Desktop App (`compressionaction/`)

A Raspberry-Pi-Imager-style GUI that lets you pick any input file, run all compression algorithms, verify integrity via SHA-256, generate graphs, and view results in a table.

### Prerequisites

- **Node.js 16+** and **npm** — [nodejs.org](https://nodejs.org)
- **Python 3** with `pandas` and `matplotlib` (for graph generation)

```bash
# Install system compressors (same as above — skip if already done)
# macOS
brew install gzip bzip2 xz zstd lz4

# Ubuntu / Debian
sudo apt-get install -y gzip bzip2 xz-utils zstd lz4

# Install Python graph-generation dependencies (only needed once)
pip install -r compressionaction/requirements.txt
```

### Run (development mode)

```bash
# Step 1 – enter the app directory
cd compressionaction

# Step 2 – install Node.js dependencies (only needed once)
npm install

# Step 3 – start Vite dev server + Electron window
npm run dev
```

The app window opens automatically. From there:

1. Select (or drag-and-drop) an input file.
2. Choose an output directory.
3. Pick which compression tools to test.
4. Click **Start Compression**.
5. Review the results table and the auto-generated graphs.

### Run the backend test script (no UI required)

```bash
# From the compressionaction/ directory
node ./src/backend/test_run.js
```

This compresses `test_file.txt` into the `out_test/` folder and prints results to the terminal.

### Build a distributable (optional)

```bash
# From the compressionaction/ directory
npm run build
```

---

## Part 3 – R ML Baseline Model (`MLFirstTry/R_baseline.R`)

An R script that reads benchmark CSV logs produced by the desktop app, engineers features, trains a Decision Tree classifier to predict the best compression algorithm, evaluates accuracy, and saves a visualisation of the tree.

### Prerequisites

- **R 4.0+** — [r-project.org](https://www.r-project.org)
- Required R packages are auto-installed by the script on first run:
  - `readr`, `dplyr`, `caret`, `rpart`, `rpart.plot`

### Run

```bash
# From the MLFirstTry/ directory
Rscript R_baseline.R
```

Or open `R_baseline.R` in RStudio and click **Source**.

The script:
1. Loads a specific benchmark CSV from `../compressionaction/logs/` (identified by its timestamp-based filename, e.g. `run_1763564918695.csv`; change the `csv_path` variable at the top of the script to use a different run).
2. Engineers the target variable (best algorithm per file by usability score).
3. Splits data into train / test sets (80 / 20).
4. Trains an `rpart` Decision Tree.
5. Prints a confusion matrix and accuracy to the console.
6. Saves `decision_tree.png` in the `MLFirstTry/` directory.

> **Note:** To use a different CSV log, edit the `csv_path` variable near the top of `R_baseline.R`.

---

## Quick-Reference Command Summary

| Task | Directory | Command |
|---|---|---|
| Install Python deps (benchmark) | project root | `pip install psutil zstandard lz4` |
| Run Python benchmark | project root | `python script.py` |
| Install Node deps (app) | `compressionaction/` | `npm install` |
| Install Python deps (graphs) | `compressionaction/` | `pip install -r requirements.txt` |
| Start desktop app | `compressionaction/` | `npm run dev` |
| Run backend test only | `compressionaction/` | `node ./src/backend/test_run.js` |
| Run R ML model | `MLFirstTry/` | `Rscript R_baseline.R` |
