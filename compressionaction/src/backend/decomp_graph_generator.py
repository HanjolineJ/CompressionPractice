import pandas as pd
import matplotlib.pyplot as plt
import sys
import os
from pathlib import Path

def generate_decompression_graphs(results_file):
    """
    Generate visualizations for decompression test results.
    Shows which compression tools produce usable decompressed files.
    """
    # Read the results file
    with open(results_file, 'r') as f:
        lines = f.readlines()
    
    # Parse results
    data = []
    for line in lines:
        line = line.strip()
        if not line or line.startswith('===') or line.startswith('Total') or line.startswith('Successful'):
            continue
        if line.startswith('Processing:'):
            current_file = line.split(': ')[1]
            current_data = {'file': current_file}
        elif line.strip().startswith('Tool:'):
            current_data['tool'] = line.split(': ')[1].upper()
        elif line.strip().startswith('Compressed size:'):
            size_str = line.split(': ')[1].split(' ')[0]
            current_data['compressed_bytes'] = int(size_str)
        elif line.strip().startswith('Decompressed size:'):
            size_str = line.split(': ')[1].split(' ')[0]
            current_data['decompressed_bytes'] = int(size_str)
        elif line.strip().startswith('Hash match:'):
            match_result = line.split(': ')[1]
            current_data['verified'] = 'YES' if 'YES' in match_result else 'NO'
            current_data['status'] = 'USABLE' if 'YES' in match_result else 'FAILED'
            data.append(current_data.copy())
    
    if len(data) == 0:
        print("No data to plot")
        return None
    
    # Create DataFrame
    df = pd.DataFrame(data)
    
    # Filter only test_file.txt compressions for cleaner visualization
    df = df[df['file'].str.contains('test_file.txt')].copy()
    
    if len(df) == 0:
        print("No test_file.txt compressions found")
        return None
    
    # Calculate compression ratio
    df['compression_ratio_pct'] = ((df['decompressed_bytes'] - df['compressed_bytes']) / df['decompressed_bytes'] * 100)
    
    # Setup the figure
    fig = plt.figure(figsize=(16, 10))
    fig.suptitle('Decompression Verification Results', fontsize=16, fontweight='bold')
    
    # Define colors
    colors_verified = ['#51cf66' if v == 'YES' else '#ff6b6b' for v in df['verified']]
    
    # 1. Verification Status Bar Chart
    ax1 = plt.subplot(2, 3, 1)
    bars1 = ax1.bar(df['tool'], [1 if v == 'YES' else 0 for v in df['verified']], color=colors_verified)
    ax1.set_xlabel('Compression Tool', fontweight='bold')
    ax1.set_ylabel('Verification Status', fontweight='bold')
    ax1.set_title('Decompression Verification Success')
    ax1.set_ylim(0, 1.2)
    ax1.set_yticks([0, 1])
    ax1.set_yticklabels(['FAILED', 'VERIFIED'])
    ax1.grid(axis='y', alpha=0.3)
    
    # Add labels
    for i, (bar, verified) in enumerate(zip(bars1, df['verified'])):
        height = bar.get_height()
        label = 'USABLE' if verified == 'YES' else 'FAILED'
        ax1.text(bar.get_x() + bar.get_width()/2., height + 0.05,
                label, ha='center', va='bottom', fontsize=9, fontweight='bold')
    
    # 2. Compression Ratio with Verification Status
    ax2 = plt.subplot(2, 3, 2)
    bars2 = ax2.bar(df['tool'], df['compression_ratio_pct'], color=colors_verified, alpha=0.8)
    ax2.set_xlabel('Compression Tool', fontweight='bold')
    ax2.set_ylabel('Space Saved (%)', fontweight='bold')
    ax2.set_title('Compression Efficiency (Verified Tools Only)')
    ax2.grid(axis='y', alpha=0.3)
    
    # Add value labels
    for bar, ratio in zip(bars2, df['compression_ratio_pct']):
        height = bar.get_height()
        ax2.text(bar.get_x() + bar.get_width()/2., height,
                f'{height:.1f}%', ha='center', va='bottom', fontsize=9)
    
    # 3. File Size Comparison
    ax3 = plt.subplot(2, 3, 3)
    x = range(len(df))
    width = 0.35
    
    compressed_mb = df['compressed_bytes'] / 1024
    decompressed_mb = df['decompressed_bytes'] / 1024
    
    ax3.bar([i - width/2 for i in x], decompressed_mb, width, label='Original Size', color='#ff6b6b', alpha=0.8)
    ax3.bar([i + width/2 for i in x], compressed_mb, width, label='Compressed Size', color='#4ecdc4', alpha=0.8)
    ax3.set_xlabel('Compression Tool', fontweight='bold')
    ax3.set_ylabel('File Size (KB)', fontweight='bold')
    ax3.set_title('Size Comparison After Decompression')
    ax3.set_xticks(x)
    ax3.set_xticklabels(df['tool'])
    ax3.legend()
    ax3.grid(axis='y', alpha=0.3)
    
    # 4. Verification Status Pie Chart
    ax4 = plt.subplot(2, 3, 4)
    verified_count = (df['verified'] == 'YES').sum()
    failed_count = (df['verified'] == 'NO').sum()
    
    sizes = [verified_count, failed_count] if failed_count > 0 else [verified_count]
    labels = ['VERIFIED\n(Usable)', 'FAILED\n(Corrupted)'] if failed_count > 0 else ['VERIFIED\n(Usable)']
    colors_pie = ['#51cf66', '#ff6b6b'] if failed_count > 0 else ['#51cf66']
    explode = (0.1, 0) if failed_count > 0 else (0.1,)
    
    ax4.pie(sizes, explode=explode, labels=labels, colors=colors_pie, autopct='%1.0f%%',
            shadow=True, startangle=90, textprops={'fontsize': 11, 'fontweight': 'bold'})
    ax4.set_title('Overall Verification Success Rate')
    
    # 5. Individual Tool Status
    ax5 = plt.subplot(2, 3, 5)
    ax5.axis('off')
    
    status_text = "DECOMPRESSION TEST RESULTS\n\n"
    for idx, row in df.iterrows():
        status_icon = 'PASS' if row['verified'] == 'YES' else 'FAIL'
        color_text = 'green' if row['verified'] == 'YES' else 'red'
        status_text += f"{row['tool']}: {status_icon}\n"
    
    status_text += f"\n\nTotal Tested: {len(df)}\n"
    status_text += f"Verified: {verified_count}\n"
    status_text += f"Failed: {failed_count}\n"
    status_text += f"\nSuccess Rate: {(verified_count/len(df)*100):.1f}%"
    
    ax5.text(0.5, 0.5, status_text, 
             ha='center', va='center',
             fontsize=12, fontfamily='monospace',
             bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))
    ax5.set_title('Tool-by-Tool Status', fontweight='bold', pad=20)
    
    # 6. Summary Table
    ax6 = plt.subplot(2, 3, 6)
    ax6.axis('off')
    
    summary_data = []
    for idx, row in df.iterrows():
        summary_data.append([
            row['tool'],
            f"{row['compression_ratio_pct']:.1f}%",
            f"{row['decompressed_bytes']} B",
            row['status']
        ])
    
    table = ax6.table(cellText=summary_data,
                     colLabels=['Tool', 'Saved', 'Final Size', 'Status'],
                     cellLoc='center',
                     loc='center',
                     colColours=['#f0f0f0']*4)
    
    table.auto_set_font_size(False)
    table.set_fontsize(9)
    table.scale(1, 2)
    
    # Color code status column
    for i in range(1, len(summary_data) + 1):
        cell = table[(i, 3)]
        if df.iloc[i-1]['verified'] == 'YES':
            cell.set_facecolor('#d4edda')
        else:
            cell.set_facecolor('#f8d7da')
    
    ax6.set_title('Decompression Summary', fontweight='bold', pad=20)
    
    plt.tight_layout(rect=[0, 0.03, 1, 0.96])
    
    # Save the figure
    output_path = results_file.replace('.txt', '_decomp_graphs.png')
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    print(f"Decompression graphs saved to: {output_path}")
    
    return output_path

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python decomp_graph_generator.py <results_file.txt>")
        sys.exit(1)
    
    results_file = sys.argv[1]
    
    if not os.path.exists(results_file):
        print(f"Error: Results file not found at {results_file}")
        sys.exit(1)
    
    try:
        output_path = generate_decompression_graphs(results_file)
        if output_path:
            print(f"SUCCESS:{output_path}")
    except Exception as e:
        print(f"ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
