import argparse
import csv
import difflib
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

# Default compression levels for each algorithm
DEFAULT_LEVELS = {
    'gzip': [6],
    'bzip2': [6], 
    'xz': [6],
    'zstd': [5],
    'lz4': [0]  # 0 is fast mode
}

# Command templates for each algorithm
COMPRESSION_COMMANDS = {
    'gzip': {'cmd': 'gzip', 'level_flag': '-{level}', 'ext': '.gz'},
    'bzip2': {'cmd': 'bzip2', 'level_flag': '-{level}', 'ext': '.bz2'},
    'xz': {'cmd': 'xz', 'level_flag': '-{level}', 'ext': '.xz'},
    'zstd': {'cmd': 'zstd', 'level_flag': '-{level}', 'ext': '.zst'},
    'lz4': {'cmd': 'lz4', 'level_flag': '-{level}', 'ext': '.lz4'}
}

def check_tool_availability() -> Dict[str, bool]:
    """Check which compression tools are available on the system."""
    available = {}
    for algo, info in COMPRESSION_COMMANDS.items():
        available[algo] = shutil.which(info['cmd']) is not None
    return available

def parse_levels_arg(levels_str: str) -> Dict[str, List[int]]:
    """Parse the --levels argument into a dict of algorithm -> levels."""
    levels = {}
    if not levels_str:
        return DEFAULT_LEVELS.copy()
    
    for part in levels_str.split():
        if '=' not in part:
            continue
        algo, level_list = part.split('=', 1)
        try:
            levels[algo] = [int(x.strip()) for x in level_list.split(',')]
        except ValueError:
            print(f"Warning: Invalid levels for {algo}: {level_list}")
            continue
    
    # Fill in defaults for unspecified algorithms
    for algo in COMPRESSION_COMMANDS:
        if algo not in levels:
            levels[algo] = DEFAULT_LEVELS[algo].copy()
    
    return levels

def find_files_in_dirs(search_dirs: List[Path], extensions: List[str] = None) -> List[Tuple[Path, os.stat_result]]:
    """Find files in the given directories (one level deep)."""
    files = []
    for search_dir in search_dirs:
        if not search_dir.exists():
            continue
        
        # Current directory
        try:
            for item in search_dir.iterdir():
                if item.is_file():
                    if extensions is None or item.suffix.lower() in extensions:
                        files.append((item, item.stat()))
        except PermissionError:
            continue
            
        # One level below
        try:
            for subdir in search_dir.iterdir():
                if subdir.is_dir():
                    for item in subdir.iterdir():
                        if item.is_file():
                            if extensions is None or item.suffix.lower() in extensions:
                                files.append((item, item.stat()))
        except PermissionError:
            continue
    
    return files

def fuzzy_match_files(files: List[Tuple[Path, os.stat_result]], query: str) -> List[Tuple[Path, os.stat_result, float]]:
    """Fuzzy match files against a query string."""
    matches = []
    query_lower = query.lower()
    
    for file_path, stat_info in files:
        filename = file_path.name.lower()
        # Use difflib for fuzzy matching
        ratio = difflib.SequenceMatcher(None, query_lower, filename).ratio()
        
        # Also check if query words are in filename
        query_words = query_lower.split()
        word_matches = sum(1 for word in query_words if word in filename)
        word_ratio = word_matches / len(query_words) if query_words else 0
        
        # Combine ratios
        final_ratio = max(ratio, word_ratio * 0.8)
        
        if final_ratio > 0.3:  # Minimum threshold
            matches.append((file_path, stat_info, final_ratio))
    
    return sorted(matches, key=lambda x: x[2], reverse=True)

def discover_input_file(args) -> Optional[Path]:
    """Discover input file based on arguments."""
    # If input is provided, try to use it
    if args.input:
        input_path = Path(args.input).expanduser().resolve()
        if input_path.exists() and input_path.is_file():
            return input_path
        else:
            print(f"Warning: Specified input file not found: {args.input}")
    
    # Search directories
    search_dirs = [
        Path.cwd(),
        Path.home() / "Downloads",
        Path.home() / "Desktop"
    ]
    
    print("Searching for files in:")
    for d in search_dirs:
        print(f"  {d}")
    
    # Find all files
    files = find_files_in_dirs(search_dirs)
    
    if not files:
        print("No files found in search directories.")
        return None
    
    # Filter by fuzzy name if provided
    if args.name:
        matches = fuzzy_match_files(files, args.name)
        if matches:
            files = [(path, stat_info) for path, stat_info, _ in matches[:20]]  # Top 20 matches
        else:
            print(f"No files matched fuzzy query: {args.name}")
            return None
    
    # Auto-pick largest if requested
    if args.largest:
        largest = max(files, key=lambda x: x[1].st_size)
        print(f"Auto-selected largest file: {largest[0]} ({format_size(largest[1].st_size)})")
        return largest[0]
    
    # Show menu if multiple files
    if len(files) > 1:
        print(f"\nFound {len(files)} files:")
        for i, (file_path, stat_info) in enumerate(files[:20], 1):
            size_str = format_size(stat_info.st_size)
            mod_time = time.strftime('%Y-%m-%d %H:%M', time.localtime(stat_info.st_mtime))
            print(f"  {i:2}. {file_path.name} ({size_str}, modified {mod_time})")
            print(f"      {file_path}")
        
        if len(files) > 20:
            print(f"      ... and {len(files) - 20} more")
        
        try:
            choice = input("\nSelect file number (or press Enter for #1): ").strip()
            if not choice:
                choice = "1"
            index = int(choice) - 1
            if 0 <= index < min(len(files), 20):
                return files[index][0]
            else:
                print("Invalid selection.")
                return None
        except (ValueError, KeyboardInterrupt):
            print("Invalid selection.")
            return None
    elif len(files) == 1:
        return files[0][0]
    
    return None

def format_size(size_bytes: int) -> str:
    """Format file size in human-readable format."""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"

def format_duration(seconds: float) -> str:
    """Format duration in human-readable format."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        return f"{seconds/60:.1f}m"
    else:
        return f"{seconds/3600:.1f}h"

def check_disk_space(output_dir: Path, input_size: int) -> bool:
    """Check if there's enough disk space for compression."""
    try:
        usage = shutil.disk_usage(output_dir)
        # Require input size + 10% headroom
        required = int(input_size * 1.1)
        return usage.free >= required
    except OSError:
        return True  # Assume OK if we can't check

def run_compression(algo: str, level: int, input_path: Path, output_dir: Path, quiet: bool = False) -> Dict[str, Any]:
    """Run compression algorithm and return metrics."""
    if algo not in COMPRESSION_COMMANDS:
        return {'error': f'Unknown algorithm: {algo}'}
    
    cmd_info = COMPRESSION_COMMANDS[algo]
    
    # Generate output filename
    level_suffix = f".lv{level}" if level != DEFAULT_LEVELS.get(algo, [0])[0] else ""
    output_name = f"{input_path.stem}{level_suffix}{cmd_info['ext']}"
    output_path = output_dir / output_name
    
    # Build command
    cmd = [cmd_info['cmd']]
    
    # Add level flag
    level_flag = cmd_info['level_flag'].format(level=level)
    if level_flag != '-0' or algo == 'lz4':  # lz4 uses -0 for fast mode
        cmd.append(level_flag)
    
    # Add algorithm-specific flags
    if algo == 'lz4':
        cmd.extend([str(input_path), str(output_path)])
    else:
        cmd.extend(['-c', str(input_path)])
    
    input_size = input_path.stat().st_size
    
    if not quiet:
        print(f"Running {algo} level {level}... ", end='', flush=True)
    
    # Check disk space
    if not check_disk_space(output_dir, input_size):
        if not quiet:
            print("SKIPPED (insufficient disk space)")
        return {'error': 'Insufficient disk space'}
    
    try:
        start_time = time.monotonic()
        
        if algo == 'lz4':
            # lz4 handles output file directly
            result = subprocess.run(cmd, capture_output=True, text=True)
        else:
            # Others output to stdout, redirect to file
            with open(output_path, 'wb') as out_file:
                result = subprocess.run(cmd, stdout=out_file, stderr=subprocess.PIPE, text=False)
        
        end_time = time.monotonic()
        elapsed = end_time - start_time
        
        if result.returncode != 0:
            if not quiet:
                print(f"FAILED (exit code {result.returncode})")
            if result.stderr:
                print(f"  Error: {result.stderr.decode() if isinstance(result.stderr, bytes) else result.stderr}")
            return {
                'algorithm': algo,
                'level': level,
                'elapsed_s': elapsed,
                'output_bytes': 0,
                'ratio': float('inf'),
                'throughput_MBps': 0.0,
                'output_path': str(output_path),
                'exit_code': result.returncode,
                'error': f'Compression failed with exit code {result.returncode}'
            }
        
        # Get output size
        try:
            output_size = output_path.stat().st_size
        except FileNotFoundError:
            output_size = 0
        
        ratio = output_size / input_size if input_size > 0 else float('inf')
        throughput = (input_size / (1024 * 1024)) / elapsed if elapsed > 0 else 0.0
        
        if not quiet:
            print(f"OK ({format_size(output_size)}, {ratio:.3f} ratio, {format_duration(elapsed)})")
        
        return {
            'algorithm': algo,
            'level': level,
            'elapsed_s': elapsed,
            'output_bytes': output_size,
            'ratio': ratio,
            'throughput_MBps': throughput,
            'output_path': str(output_path),
            'exit_code': 0
        }
        
    except Exception as e:
        if not quiet:
            print(f"ERROR: {e}")
        return {'error': str(e)}

def run_custom_algorithm(input_path: Path, output_dir: Path) -> Optional[Dict[str, Any]]:
    """
    Hook for custom compression algorithms.
    
    TODO: Implement your custom algorithm here and uncomment the call in main().
    
    Return a dict with the same keys as standard algorithms:
    - algorithm: str
    - level: int (or 0 if not applicable)
    - elapsed_s: float
    - output_bytes: int
    - ratio: float
    - throughput_MBps: float
    - output_path: str
    - exit_code: int
    
    Or return None to skip.
    """
    return None

def print_results_table(results: List[Dict[str, Any]]):
    """Print a formatted results table."""
    if not results:
        print("No successful compression results.")
        return
    
    print("\nBenchmark Results (sorted by output size):")
    print("=" * 80)
    
    # Sort by ratio (smallest first), then by elapsed time
    sorted_results = sorted(results, key=lambda x: (x.get('ratio', float('inf')), x.get('elapsed_s', 0)))
    
    # Print header
    print(f"{'Rank':<4} {'Algorithm':<10} {'Level':<5} {'Time':<8} {'Output Size':<12} {'Ratio':<8} {'MB/s':<8} {'Path':<20}")
    print("-" * 80)
    
    for rank, result in enumerate(sorted_results[:10], 1):  # Top 10
        algo = result.get('algorithm', 'unknown')
        level = result.get('level', 0)
        elapsed = result.get('elapsed_s', 0)
        output_size = result.get('output_bytes', 0)
        ratio = result.get('ratio', 0)
        throughput = result.get('throughput_MBps', 0)
        output_path = Path(result.get('output_path', '')).name
        
        print(f"{rank:<4} {algo:<10} {level:<5} {format_duration(elapsed):<8} {format_size(output_size):<12} "
              f"{ratio:.3f}{'*' if rank == 1 else ' ':<4} {throughput:.1f}{'MB/s':<3} {output_path:<20}")

def save_csv_results(results: List[Dict[str, Any]], csv_path: Path):
    """Save results to CSV file."""
    if not results:
        return
    
    fieldnames = ['algorithm', 'level', 'elapsed_s', 'output_bytes', 'ratio', 'throughput_MBps', 'output_path', 'exit_code']
    
    with open(csv_path, 'w', newline='') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        
        for result in results:
            # Only write successful results to CSV
            if 'error' not in result:
                row = {k: result.get(k, '') for k in fieldnames}
                writer.writerow(row)
    
    print(f"\nResults saved to: {csv_path}")

def cleanup_non_best(results: List[Dict[str, Any]]):
    """Delete all output files except the best one."""
    if len(results) <= 1:
        return
    
    # Find the best result (smallest ratio)
    best_result = min(results, key=lambda x: x.get('ratio', float('inf')))
    best_path = best_result.get('output_path')
    
    deleted_count = 0
    for result in results:
        if 'error' in result:
            continue
        output_path = result.get('output_path')
        if output_path and output_path != best_path:
            try:
                Path(output_path).unlink()
                deleted_count += 1
            except FileNotFoundError:
                pass  # Already deleted or never existed
            except Exception as e:
                print(f"Warning: Could not delete {output_path}: {e}")
    
    if deleted_count > 0:
        print(f"Deleted {deleted_count} non-best output files. Kept: {Path(best_path).name}")

def main():
    parser = argparse.ArgumentParser(description="Compression Benchmarking Launcher")
    parser.add_argument('--input', help='Input file path')
    parser.add_argument('--output-dir', default='./compressed_out', help='Output directory (default: ./compressed_out)')
    parser.add_argument('--keep-only-best', action='store_true', help='Delete all outputs except the best one')
    parser.add_argument('--algos', help='Comma-separated list of algorithms (e.g., gzip,xz,zstd)')
    parser.add_argument('--levels', help='Compression levels (e.g., gzip=1,6,9 zstd=1,5,10 xz=6)')
    parser.add_argument('--name', help='Fuzzy match filenames with this query')
    parser.add_argument('--largest', action='store_true', help='Auto-pick the largest discovered file')
    parser.add_argument('--dry-run', action='store_true', help='Print commands without running them')
    parser.add_argument('--quiet', action='store_true', help='Minimal console output')
    
    args = parser.parse_args()
    
    # Discover input file
    input_path = discover_input_file(args)
    if not input_path:
        print("Error: No input file found or specified.")
        return 1
    
    if not args.quiet:
        input_size = input_path.stat().st_size
        print(f"\nInput file: {input_path}")
        print(f"Size: {format_size(input_size)}")
    
    # Set up output directory
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Check tool availability
    available_tools = check_tool_availability()
    
    # Determine which algorithms to run
    if args.algos:
        requested_algos = [algo.strip() for algo in args.algos.split(',')]
    else:
        requested_algos = list(COMPRESSION_COMMANDS.keys())
    
    # Filter by availability
    algos_to_run = []
    for algo in requested_algos:
        if algo in available_tools:
            if available_tools[algo]:
                algos_to_run.append(algo)
            else:
                print(f"Warning: {algo} not available on this system (skipping)")
        else:
            print(f"Warning: Unknown algorithm {algo} (skipping)")
    
    if not algos_to_run:
        print("Error: No compression algorithms available.")
        return 1
    
    # Parse levels
    levels = parse_levels_arg(args.levels)
    
    if not args.quiet:
        print(f"Running algorithms: {', '.join(algos_to_run)}")
        print(f"Output directory: {output_dir}")
    
    # Dry run mode
    if args.dry_run:
        print("\nDry run - commands that would be executed:")
        for algo in algos_to_run:
            for level in levels.get(algo, DEFAULT_LEVELS[algo]):
                cmd_info = COMPRESSION_COMMANDS[algo]
                level_suffix = f".lv{level}" if level != DEFAULT_LEVELS.get(algo, [0])[0] else ""
                output_name = f"{input_path.stem}{level_suffix}{cmd_info['ext']}"
                output_path = output_dir / output_name
                
                cmd = [cmd_info['cmd']]
                level_flag = cmd_info['level_flag'].format(level=level)
                if level_flag != '-0' or algo == 'lz4':
                    cmd.append(level_flag)
                
                if algo == 'lz4':
                    cmd.extend([str(input_path), str(output_path)])
                else:
                    cmd.extend(['-c', str(input_path), '>', str(output_path)])
                
                print(f"  {' '.join(cmd)}")
        return 0
    
    # Run compressions
    results = []
    successful_runs = 0
    
    for algo in algos_to_run:
        for level in levels.get(algo, DEFAULT_LEVELS[algo]):
            result = run_compression(algo, level, input_path, output_dir, args.quiet)
            if 'error' not in result:
                results.append(result)
                successful_runs += 1
            elif not args.quiet:
                print(f"Failed: {algo} level {level} - {result.get('error', 'Unknown error')}")
    
    # TODO: Uncomment to enable custom algorithm
    # custom_result = run_custom_algorithm(input_path, output_dir)
    # if custom_result:
    #     results.append(custom_result)
    #     successful_runs += 1
    
    if successful_runs == 0:
        print("Error: All compression attempts failed.")
        return 1
    
    # Print results
    if not args.quiet:
        print_results_table(results)
    
    # Save CSV
    csv_path = Path('benchmark_results.csv')
    save_csv_results(results, csv_path)
    
    # Cleanup if requested
    if args.keep_only_best and len(results) > 1:
        cleanup_non_best(results)
    
    if not args.quiet:
        print(f"\nCompleted {successful_runs} successful compression runs.")
    
    return 0

if __name__ == '__main__':
    sys.exit(main())