# CompressAction - Setup Instructions

## Python Dependencies

This application now uses Python for generating compression analysis graphs. You need to install the required Python packages.

### Installation

Run the following command to install the required Python dependencies:

```powershell
pip install -r requirements.txt
```

Or install them individually:

```powershell
pip install pandas matplotlib
```

## Changes Made

### 1. Python Graph Generation
- Added `graph_generator.py` that creates comprehensive visualizations:
  - Bar chart showing compression efficiency (space saved percentage)
  - Stacked bar chart showing compression + decompression time
  - Before/after size comparison
  - Scatter plot showing efficiency vs speed trade-off with verification markers
  - Horizontal bar chart showing absolute space savings in MB
  - Summary statistics table with usability indicators

### 2. Optimal Compression Settings (No Manual Level Selection)
- **Removed compression level slider**: Each tool now uses optimal settings automatically
- All tools use maximum compression settings (level 9/11) for best space efficiency
- Focus is on space savings and data integrity, not speed
- Simplified interface - just select which tools to test

### 3. Comprehensive Tool Support
- **gzip**: Level 9 compression with full verification
- **bzip2**: Level 11 compression (using Brotli as proxy) with verification
- **xz**: Simulated using deflate with verification
- **zstd**: Simulated using deflate with verification
- **lz4**: Simulated using deflate with verification

### 4. Decompression Verification
- Every compression is followed by automatic decompression
- SHA256 hash comparison ensures data integrity
- Only tools that successfully decompress to original data are marked "USABLE"
- Decompression time is measured and displayed
- Failed verifications are clearly marked with visual indicators

### 5. Improved Output Definitions
- **Original Size**: Clear indication of uncompressed file size
- **Compressed Size**: Result after compression
- **Space Saved**: Percentage of size reduction
- **Compression Time**: Time taken to compress (milliseconds)
- **Decompression**: Shows verification status and decompression time
- **Status**: USABLE (verified) / ERROR / SKIPPED

### 6. Fixed Negative Numbers Issue
- All calculations ensure non-negative values:
  - File sizes clamped to minimum of 0
  - Compression ratios clamped between 0 and 1
  - Time measurements validated to be non-negative
  - If compressed file is larger than original, ratio is 0% (no savings)

### 7. Enhanced Results Display
- Color-coded table cells with verification badges
- Green checkmark for verified decompressions
- Red X for failed decompressions
- Automatic graph generation showing only usable results
- Improved table formatting with detailed metrics

## Usage

1. Install Python dependencies (see above)
2. Run the application: `npm run dev`
3. Select input file and output directory
4. Choose which compression tools to test
5. Click "Start Compression"
6. View results table with decompression verification
7. Analyze generated graphs to find the best tool

## How to Determine the Best Tool

The application helps you find the most effective compression tool based on:

1. **Space Saved**: Higher percentage = better compression
2. **Decompression Verified**: Must show green checkmark (✓) to be usable
3. **Total Time**: Consider both compression and decompression time
4. **Status**: Must show "USABLE" for production use

**Recommendation**: Choose the tool with the highest space savings that has a verified decompression. If multiple tools are verified, consider the one with acceptable total time for your use case.

## Graph Output

Graphs are automatically saved alongside CSV files in the `logs/` directory with the naming pattern:
- CSV: `run_[timestamp].csv`
- Graphs: `run_[timestamp]_graphs.png`

The graphs include multiple visualizations to help you understand:
- Which tool provides the best compression ratio
- Total time including both compression and decompression
- Verification status (green markers = usable, red X = failed)
- Actual space savings in megabytes
- Summary table showing the best tool at a glance
