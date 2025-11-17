import pandas as pd
import matplotlib.pyplot as plt
import sys
import os
from pathlib import Path

def generate_compression_graphs(csv_path):
    """
    Generate appropriate graphs for compression benchmark data.
    Creates multiple visualization types suitable for compression metrics.
    """
    # Read the CSV data
    df = pd.read_csv(csv_path)
    
    # Filter out skipped or error entries, and only show verified decompressions
    df = df[df['status'] == 'ok'].copy()
    
    if len(df) == 0:
        print("No valid data to plot")
        return
    
    # Calculate compression ratio percentage for better readability
    df['compression_ratio_pct'] = df['ratio_saved'] * 100
    df['size_reduction_mb'] = (df['src_bytes'] - df['dst_bytes']) / (1024 * 1024)
    df['total_time_ms'] = df['compress_ms'] + df['decompress_ms']
    df['verified_icon'] = df['verified'].apply(lambda x: 'YES' if x == 'yes' else 'NO')
    
    # Setup the figure with subplots
    fig = plt.figure(figsize=(16, 10))
    fig.suptitle('Compression Benchmark Results', fontsize=16, fontweight='bold')
    
    # Define colors for consistency
    colors = plt.cm.Set3(range(len(df)))
    
    # 1. Bar chart: Compression Ratio by Tool
    ax1 = plt.subplot(2, 3, 1)
    bars1 = ax1.bar(df['tool'], df['compression_ratio_pct'], color=colors)
    ax1.set_xlabel('Compression Tool', fontweight='bold')
    ax1.set_ylabel('Space Saved (%)', fontweight='bold')
    ax1.set_title('Compression Efficiency')
    ax1.set_ylim(0, 100)
    ax1.grid(axis='y', alpha=0.3)
    
    # Add value labels on bars
    for bar in bars1:
        height = bar.get_height()
        ax1.text(bar.get_x() + bar.get_width()/2., height,
                f'{height:.1f}%',
                ha='center', va='bottom', fontsize=9)
    
    # 2. Stacked bar chart: Compression + Decompression Time
    ax2 = plt.subplot(2, 3, 2)
    ax2.bar(df['tool'], df['compress_ms'], label='Compression', color='#ff6b6b', alpha=0.8)
    ax2.bar(df['tool'], df['decompress_ms'], bottom=df['compress_ms'], label='Decompression', color='#4ecdc4', alpha=0.8)
    ax2.set_xlabel('Compression Tool', fontweight='bold')
    ax2.set_ylabel('Time (milliseconds)', fontweight='bold')
    ax2.set_title('Compression + Decompression Time')
    ax2.legend()
    ax2.grid(axis='y', alpha=0.3)
    
    # Add total time labels on bars
    for idx, row in df.iterrows():
        total = row['total_time_ms']
        ax2.text(idx, total, f'{total:.1f}ms',
                ha='center', va='bottom', fontsize=9)
    
    # 3. Before/After comparison
    ax3 = plt.subplot(2, 3, 3)
    x = range(len(df))
    width = 0.35
    
    src_mb = df['src_bytes'] / (1024 * 1024)
    dst_mb = df['dst_bytes'] / (1024 * 1024)
    
    ax3.bar([i - width/2 for i in x], src_mb, width, label='Original Size', color='#ff6b6b', alpha=0.8)
    ax3.bar([i + width/2 for i in x], dst_mb, width, label='Compressed Size', color='#4ecdc4', alpha=0.8)
    ax3.set_xlabel('Compression Tool', fontweight='bold')
    ax3.set_ylabel('File Size (MB)', fontweight='bold')
    ax3.set_title('Size Comparison: Original vs Compressed')
    ax3.set_xticks(x)
    ax3.set_xticklabels(df['tool'])
    ax3.legend()
    ax3.grid(axis='y', alpha=0.3)
    
    # 4. Scatter plot: Compression Ratio vs Total Time (with verification markers)
    ax4 = plt.subplot(2, 3, 4)
    
    # Separate verified and unverified
    verified_df = df[df['verified'] == 'yes']
    unverified_df = df[df['verified'] != 'yes']
    
    if len(verified_df) > 0:
        ax4.scatter(verified_df['total_time_ms'], verified_df['compression_ratio_pct'], 
                   s=200, c='green', alpha=0.7, edgecolors='black', marker='o', label='Verified')
    if len(unverified_df) > 0:
        ax4.scatter(unverified_df['total_time_ms'], unverified_df['compression_ratio_pct'], 
                   s=200, c='red', alpha=0.7, edgecolors='black', marker='x', label='Failed')
    
    # Label each point with the tool name
    for idx, row in df.iterrows():
        ax4.annotate(row['tool'], 
                    (row['total_time_ms'], row['compression_ratio_pct']),
                    xytext=(5, 5), textcoords='offset points', fontsize=9)
    
    ax4.set_xlabel('Total Time: Compress + Decompress (ms)', fontweight='bold')
    ax4.set_ylabel('Space Saved (%)', fontweight='bold')
    ax4.set_title('Efficiency vs Speed (Verified Only = Usable)')
    ax4.legend()
    ax4.grid(True, alpha=0.3)
    
    # 5. Horizontal bar chart: Space saved in MB
    ax5 = plt.subplot(2, 3, 5)
    bars5 = ax5.barh(df['tool'], df['size_reduction_mb'], color=colors)
    ax5.set_xlabel('Space Saved (MB)', fontweight='bold')
    ax5.set_ylabel('Compression Tool', fontweight='bold')
    ax5.set_title('Absolute Space Savings')
    ax5.grid(axis='x', alpha=0.3)
    
    # Add value labels on bars
    for bar in bars5:
        width = bar.get_width()
        ax5.text(width, bar.get_y() + bar.get_height()/2.,
                f'{width:.2f} MB',
                ha='left', va='center', fontsize=9, style='italic')
    
    # 6. Summary statistics table
    ax6 = plt.subplot(2, 3, 6)
    ax6.axis('off')
    
    # Create summary data
    summary_data = []
    for idx, row in df.iterrows():
        verified_mark = 'YES' if row['verified'] == 'yes' else 'NO'
        summary_data.append([
            row['tool'].upper(),
            f"{row['compression_ratio_pct']:.1f}%",
            f"{row['total_time_ms']:.1f}ms",
            verified_mark
        ])
    
    table = ax6.table(cellText=summary_data,
                     colLabels=['Tool', 'Space Saved', 'Total Time', 'Usable'],
                     cellLoc='center',
                     loc='center',
                     colColours=['#f0f0f0']*4)
    
    table.auto_set_font_size(False)
    table.set_fontsize(9)
    table.scale(1, 2)
    ax6.set_title('Summary: Best Tool = Most Space Saved + Verified', fontweight='bold', pad=20)
    
    # Adjust layout to prevent overlap
    plt.tight_layout(rect=[0, 0.03, 1, 0.96])
    
    # Save the figure
    output_path = csv_path.replace('.csv', '_graphs.png')
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    print(f"Graphs saved to: {output_path}")
    
    return output_path

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python graph_generator.py <csv_path>")
        sys.exit(1)
    
    csv_path = sys.argv[1]
    
    if not os.path.exists(csv_path):
        print(f"Error: CSV file not found at {csv_path}")
        sys.exit(1)
    
    try:
        output_path = generate_compression_graphs(csv_path)
        print(f"SUCCESS:{output_path}")
    except Exception as e:
        print(f"ERROR: {str(e)}")
        sys.exit(1)
