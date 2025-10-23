# CompressAction

An application that uses lossless compression algorithm(s) on large datasets and video games, with evaluation by ratio, time, memory, and random-access latency. Establishing a baseline, then heading towards a secure, containerized workflow.

## Install
- macOS: `brew install gzip bzip2 xz zstd lz4`
- Ubuntu: `sudo apt-get install -y gzip bzip2 xz-utils zstd lz4`

## Dev
```bash
npm i
npm run dev


## Known Issues (Oct 17, 2025)

**Status:** Initial launcher code is committed but **does not run end-to-end** yet.  
I’ll troubleshoot this **Oct 17–Oct 20** and push fixes.

## Quick start (developer)

Requirements: Node.js and npm installed (Node 16+ recommended).

1. Install dependencies:

	npm install

2. Run in dev mode (starts Vite + Electron):

	npm run dev

3. In the app UI: choose an input file (or drag-and-drop a file into the Input area), choose an output directory, then click "Start Compression". Currently the backend uses Node's gzip to produce a .gz file as a simple, cross-platform fallback.

## Test runner

There's a small test script at `src/backend/test_run.js` which will compress `sample_files.txt` into an `out_test` folder when executed with Node:

	node ./src/backend/test_run.js

If Node/npm are not available on your system, please install them or run the app on a machine with Node.
