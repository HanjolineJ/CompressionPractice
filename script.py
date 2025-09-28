#!/usr/bin/env python3
"""
Compressor Research Script
Compresses GameAsset.txt, LargeDataset.txt, and sample_files.txt using multiple algorithms
"""
import gzip
import bz2
import lzma
import os
import time
import psutil
from pathlib import Path

# Optional compression libraries
OPTIONAL_LIBS = {}
try:
    import zstandard as zstd
    OPTIONAL_LIBS['zstd'] = zstd
except ImportError:
    pass

try:
    import lz4.frame as lz4
    OPTIONAL_LIBS['lz4'] = lz4
except ImportError:
    pass

def compress_with_gzip(input_file, output_file):
    """Compress using gzip"""
    with open(input_file, 'rb') as f_in:
        with gzip.open(output_file, 'wb') as f_out:
            f_out.writelines(f_in)

def compress_with_bzip2(input_file, output_file):
    """Compress using bzip2"""
    with open(input_file, 'rb') as f_in:
        with bz2.open(output_file, 'wb') as f_out:
            f_out.writelines(f_in)

def compress_with_xz(input_file, output_file):
    """Compress using xz (lzma)"""
    with open(input_file, 'rb') as f_in:
        with lzma.open(output_file, 'wb') as f_out:
            f_out.writelines(f_in)

def compress_with_zstd(input_file, output_file):
    """Compress using zstandard"""
    if 'zstd' not in OPTIONAL_LIBS:
        raise ImportError("zstandard not available")
    
    cctx = OPTIONAL_LIBS['zstd'].ZstdCompressor()
    with open(input_file, 'rb') as f_in:
        with open(output_file, 'wb') as f_out:
            cctx.copy_stream(f_in, f_out)

def compress_with_lz4(input_file, output_file):
    """Compress using lz4"""
    if 'lz4' not in OPTIONAL_LIBS:
        raise ImportError("lz4 not available")
    
    with open(input_file, 'rb') as f_in:
        with open(output_file, 'wb') as f_out:
            OPTIONAL_LIBS['lz4'].compress_stream(f_in, f_out)

def compress_file(input_file, output_dir=".venv"):
    """Compress a single file using all available algorithms"""
    # Create output directory if it doesn't exist
    Path(output_dir).mkdir(exist_ok=True)
    
    algorithms = [
        ('gzip', '.gz', compress_with_gzip),
        ('bzip2', '.bz2', compress_with_bzip2),
        ('xz', '.xz', compress_with_xz),
        ('zstd', '.zst', compress_with_zstd),
        ('lz4', '.lz4', compress_with_lz4)
    ]
    
    results = {}
    base_name = Path(input_file).name
    
    for algo_name, extension, compress_func in algorithms:
        output_file = Path(output_dir) / f"{base_name}{extension}"
        
        try:
            start_time = time.time()
            compress_func(input_file, output_file)
            compression_time = time.time() - start_time
            
            compressed_size = get_file_size(output_file)
            results[algo_name] = {
                'success': True,
                'file': str(output_file),
                'size': compressed_size,
                'time': compression_time
            }
        except ImportError:
            results[algo_name] = {
                'success': False,
                'error': 'Library not installed'
            }
        except Exception as e:
            results[algo_name] = {
                'success': False,
                'error': str(e)
            }
    
    return results

def get_file_size(filepath):
    """Get file size in bytes"""
    try:
        return os.path.getsize(filepath)
    except:
        return 0

def format_bytes(bytes_size):
    """Convert bytes to human readable format"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_size < 1024.0:
            return f"{bytes_size:.2f} {unit}"
        bytes_size /= 1024.0
    return f"{bytes_size:.2f} TB"

def main():
    # Files to compress
    files_to_compress = ['GameAsset.txt', 'LargeDataset.txt', 'sample_files.txt']
    
    print("=" * 70)
    print("MULTI-ALGORITHM COMPRESSION RESEARCH")
    print("Algorithms: gzip, bzip2, xz, zstd, lz4")
    print("Output directory: .venv/")
    print("=" * 70)
    
    # Get initial memory usage
    process = psutil.Process()
    start_memory = process.memory_info().rss
    
    # Start timing
    start_time = time.time()
    
    all_results = {}
    total_original_size = 0
    
    for filename in files_to_compress:
        print(f"\nProcessing: {filename}")
        print("-" * 50)
        
        # Check if file exists
        if not Path(filename).exists():
            print(f"File not found: {filename}")
            continue
        
        # Get original file size
        original_size = get_file_size(filename)
        total_original_size += original_size
        
        print(f"Original size: {format_bytes(original_size)}")
        print()
        
        # Compress the file with all algorithms
        results = compress_file(filename)
        all_results[filename] = results
        
        # Display results for each algorithm
        for algo_name in ['gzip', 'bzip2', 'xz', 'zstd', 'lz4']:
            result = results[algo_name]
            if result['success']:
                compressed_size = result['size']
                compression_ratio = (1 - compressed_size / original_size) * 100 if original_size > 0 else 0
                
                print(f"{algo_name:>6}: {format_bytes(compressed_size):>10} "
                      f"({compression_ratio:5.1f}% saved) "
                      f"[{result['time']:.3f}s]")
            else:
                print(f"{algo_name:>6}: {result['error']}")
    
    # End timing and memory measurement
    end_time = time.time()
    end_memory = process.memory_info().rss
    
    # Summary
    print("\n" + "=" * 70)
    print("COMPRESSION SUMMARY")
    print("=" * 70)
    
    if all_results:
        # Calculate best compression ratios
        algorithm_totals = {}
        for filename, results in all_results.items():
            original_size = get_file_size(filename)
            for algo_name, result in results.items():
                if result['success']:
                    if algo_name not in algorithm_totals:
                        algorithm_totals[algo_name] = {'total_original': 0, 'total_compressed': 0, 'total_time': 0}
                    algorithm_totals[algo_name]['total_original'] += original_size
                    algorithm_totals[algo_name]['total_compressed'] += result['size']
                    algorithm_totals[algo_name]['total_time'] += result['time']
        
        print("Algorithm Performance Summary:")
        print("-" * 50)
        for algo_name in ['gzip', 'bzip2', 'xz', 'zstd', 'lz4']:
            if algo_name in algorithm_totals:
                data = algorithm_totals[algo_name]
                ratio = (1 - data['total_compressed'] / data['total_original']) * 100
                print(f"{algo_name:>6}: {ratio:5.1f}% compression, {data['total_time']:.3f}s total")
            else:
                print(f"{algo_name:>6}: Not available")
    
    print(f"\nFiles processed:     {len(files_to_compress)}")
    print(f"Total original size: {format_bytes(total_original_size)}")
    print(f"Total time taken:    {end_time - start_time:.3f} seconds")
    print(f"Memory used:         {format_bytes(abs(end_memory - start_memory))}")
    print(f"Compressed files:    Saved to .venv/ directory")
    print("=" * 70)

if __name__ == "__main__":
    main()