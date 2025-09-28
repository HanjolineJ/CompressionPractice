#!/usr/bin/env python3
import gzip
import os
import time
import psutil
from pathlib import Path

def compress_file(input_file):
    """Compress a single file using gzip"""
    output_file = f"{input_file}.gz"
    
    try:
        with open(input_file, 'rb') as f_in:
            with gzip.open(output_file, 'wb') as f_out:
                f_out.writelines(f_in)
        return True, output_file
    except FileNotFoundError:
        return False, f"File not found: {input_file}"
    except Exception as e:
        return False, str(e)

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
    
    print("=" * 60)
    print("TEXT FILE COMPRESSION UTILITY")
    print("=" * 60)
    
    # Get initial memory usage
    process = psutil.Process()
    start_memory = process.memory_info().rss
    
    # Start timing
    start_time = time.time()
    
    total_original_size = 0
    total_compressed_size = 0
    successful_compressions = 0
    
    for filename in files_to_compress:
        print(f"\nProcessing: {filename}")
        print("-" * 40)
        
        # Check if file exists
        if not Path(filename).exists():
            print(f"❌ File not found: {filename}")
            continue
        
        # Get original file size
        original_size = get_file_size(filename)
        total_original_size += original_size
        
        # Compress the file
        success, result = compress_file(filename)
        
        if success:
            compressed_file = result
            compressed_size = get_file_size(compressed_file)
            total_compressed_size += compressed_size
            
            compression_ratio = (1 - compressed_size / original_size) * 100 if original_size > 0 else 0
            
            print(f"✅ Successfully compressed to: {compressed_file}")
            print(f"   Original size:    {format_bytes(original_size)}")
            print(f"   Compressed size:  {format_bytes(compressed_size)}")
            print(f"   Space saved:      {compression_ratio:.1f}%")
            
            successful_compressions += 1
        else:
            print(f"❌ Error: {result}")
    
    # End timing and memory measurement
    end_time = time.time()
    end_memory = process.memory_info().rss
    
    # Summary
    print("\n" + "=" * 60)
    print("COMPRESSION SUMMARY")
    print("=" * 60)
    print(f"Files processed:     {len(files_to_compress)}")
    print(f"Successful:          {successful_compressions}")
    print(f"Failed:              {len(files_to_compress) - successful_compressions}")
    
    if total_original_size > 0:
        overall_ratio = (1 - total_compressed_size / total_original_size) * 100
        print(f"Total original size: {format_bytes(total_original_size)}")
        print(f"Total compressed:    {format_bytes(total_compressed_size)}")
        print(f"Overall space saved: {overall_ratio:.1f}%")
    
    print(f"Time taken:          {end_time - start_time:.2f} seconds")
    print(f"Memory used:         {format_bytes(end_memory - start_memory)}")
    print("=" * 60)

if __name__ == "__main__":
    main()