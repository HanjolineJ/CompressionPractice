# Compression & Decompression Graphs

This folder contains visual analytics generated from compression and decompression tests.

## Graph Types

### Compression Graphs
Files ending with `_compression_graphs.png` show:
- **Compression Efficiency**: Bar chart showing space saved percentage for each tool
- **Time Analysis**: Stacked bar chart showing compression + decompression time
- **Size Comparison**: Before/after file sizes for each compression tool
- **Efficiency vs Speed**: Scatter plot with verification markers (green = verified, red = failed)
- **Absolute Savings**: Horizontal bar chart showing space saved in MB
- **Summary Table**: Quick reference showing which tools are usable

### Decompression Graphs
Files ending with `_decompression_graphs.png` show:
- **Verification Status**: Which tools successfully decompress and verify
- **Compression Ratios**: Color-coded by verification status
- **File Size Comparisons**: Original vs decompressed sizes
- **Success Rate**: Pie chart showing overall verification rate
- **Tool Status**: Individual tool verification results
- **Summary Table**: Comprehensive results for each tool

## File Naming Convention
- `run_[timestamp]_compression_graphs.png` - Compression test results
- `decomp_test_[timestamp]_decompression_graphs.png` - Decompression test results

## High Quality Output
All graphs are saved at 200 DPI with white background for clear visibility and professional presentation.
