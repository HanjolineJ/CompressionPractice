import React, { useState, useEffect } from 'react';

function prettyBytes(n) {
  if (!n && n !== 0) return '';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length-1) { v /= 1024; i++; }
  return `${v.toFixed(2)} ${units[i]}`;
}

// ── ML Recommendation Panel ──────────────────────────────────────────────────
// Renders algorithm, confidence bar, and per-class probability breakdown.
function MlRecommendationPanel({ prediction, label }) {
  const { algorithm, confidence, confident, scores, fileStats } = prediction;
  const algoColors = {
    zstd:  '#4f8cff',
    lz4:   '#51cf66',
    bzip2: '#ffd93d',
    gzip:  '#ff9f43',
    xz:    '#c084fc',
  };
  const allAlgos = ['zstd', 'lz4', 'bzip2', 'gzip', 'xz'];

  return (
    <div>
      {/* Top row: recommended algorithm + confidence */}
      <div style={{display:'flex', alignItems:'center', gap:16, marginBottom:14, flexWrap:'wrap'}}>
        <div style={{
          background: algoColors[algorithm] || '#888',
          color: '#0b0d10',
          fontWeight: 700,
          fontSize: 20,
          padding: '8px 20px',
          borderRadius: 10,
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}>
          {algorithm}
        </div>
        <div>
          <div style={{fontSize:13, opacity:0.7, marginBottom:3}}>{label}</div>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <div style={{
              width: 120,
              height: 8,
              background: '#1e2633',
              borderRadius: 4,
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${Math.round(confidence * 100)}%`,
                height: '100%',
                background: confident ? '#51cf66' : '#ffd93d',
                borderRadius: 4,
                transition: 'width 0.4s ease',
              }}/>
            </div>
            <span style={{fontSize:13, fontWeight:600, color: confident ? '#51cf66' : '#ffd93d'}}>
              {Math.round(confidence * 100)}%
            </span>
            {!confident && (
              <span style={{fontSize:11, opacity:0.6}}>(low confidence — run all)</span>
            )}
          </div>
        </div>
        {fileStats && (
          <div style={{fontSize:12, opacity:0.55, marginLeft:'auto'}}>
            {(fileStats.src_bytes / 1024).toFixed(1)} KB
            {fileStats.file_ext && fileStats.file_ext !== 'unknown' ? ` · .${fileStats.file_ext}` : ''}
            {fileStats.shannon_entropy != null ? ` · ${fileStats.shannon_entropy} bits/byte` : ''}
          </div>
        )}
      </div>

      {/* Per-algorithm probability bars */}
      {scores && (
        <div style={{display:'flex', flexDirection:'column', gap:6}}>
          {allAlgos
            .filter(a => scores[a] != null)
            .sort((a, b) => scores[b] - scores[a])
            .map(algo => (
              <div key={algo} style={{display:'flex', alignItems:'center', gap:8}}>
                <span style={{
                  width: 52,
                  fontSize: 12,
                  fontWeight: algo === algorithm ? 700 : 400,
                  color: algoColors[algo] || '#888',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}>
                  {algo}
                </span>
                <div style={{flex:1, height:6, background:'#1e2633', borderRadius:3, overflow:'hidden'}}>
                  <div style={{
                    width: `${Math.round(scores[algo] * 100)}%`,
                    height: '100%',
                    background: algo === algorithm ? (algoColors[algo] || '#4f8cff') : '#2a3a4a',
                    borderRadius: 3,
                    transition: 'width 0.4s ease',
                  }}/>
                </div>
                <span style={{
                  width: 36,
                  fontSize: 12,
                  textAlign: 'right',
                  fontWeight: algo === algorithm ? 700 : 400,
                  opacity: algo === algorithm ? 1 : 0.55,
                }}>
                  {Math.round(scores[algo] * 100)}%
                </span>
              </div>
            ))
          }
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [inputPath, setInputPath] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [tools, setTools] = useState(['zstd','xz','bzip2','gzip','lz4']);
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);
  const [csvPath, setCsvPath] = useState('');
  const [graphPath, setGraphPath] = useState('');
  const [dragOverInput, setDragOverInput] = useState(false);
  const [dragOverOutput, setDragOverOutput] = useState(false);
  const [showDecompress, setShowDecompress] = useState(false);
  const [recentFiles, setRecentFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [decompressResult, setDecompressResult] = useState(null);
  const [decompressing, setDecompressing] = useState(false);
  const [decompGraphPath, setDecompGraphPath] = useState('');
  const [decompResults, setDecompResults] = useState([]);
  const [compGraphDataUrl, setCompGraphDataUrl] = useState('');
  const [decompGraphDataUrl, setDecompGraphDataUrl] = useState('');
  const [mlPrediction, setMlPrediction] = useState(null);      // pre-run prediction
  const [mlPostRun, setMlPostRun] = useState(null);             // post-run prediction
  const [mlLoading, setMlLoading] = useState(false);

  useEffect(() => {
    // Debug: Check if API is available
    if (!window.compressAPI) {
      console.error('compressAPI is not available on window object');
    } else {
      console.log('compressAPI is available:', Object.keys(window.compressAPI));
    }
  }, []);

  const toggleTool = (t) =>
    setTools(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev, t]);

  const pickInput = async () => {
    try {
      if (!window.compressAPI) {
        alert('Electron API not loaded. Please restart the application.');
        return;
      }
      console.log('Calling pickInputFile...');
      const p = await window.compressAPI.pickInputFile();
      console.log('Result:', p);
      if (p) {
        setInputPath(p);
        setMlPrediction(null);
        setMlPostRun(null);
        // Fire prediction immediately — user sees a recommendation before clicking Run
        setMlLoading(true);
        try {
          const pred = await window.compressAPI.mlPredict(p);
          setMlPrediction(pred);
        } catch (e) {
          console.warn('ML pre-run prediction failed:', e.message);
        } finally {
          setMlLoading(false);
        }
      }
    } catch (error) {
      console.error('Error picking input file:', error);
      alert('Error opening file dialog: ' + error.message);
    }
  };
  
  const pickOut = async () => {
    try {
      if (!window.compressAPI) {
        alert('Electron API not loaded. Please restart the application.');
        return;
      }
      console.log('Calling pickOutputDir...');
      const p = await window.compressAPI.pickOutputDir();
      console.log('Result:', p);
      if (p) setOutputDir(p);
    } catch (error) {
      console.error('Error picking output directory:', error);
      alert('Error opening directory dialog: ' + error.message);
    }
  };

  const run = async () => {
    if (!inputPath || !outputDir) return;
    setRunning(true); setRows([]); setCsvPath(''); setGraphPath(''); setShowDecompress(false); setMlPostRun(null);
    try {
      const res = await window.compressAPI.runJob({ inputPath, outputDir, tools });
      setRows(res.rows || []);
      setCsvPath(res.csvPath || '');
      setGraphPath(res.graphPath || '');

      // Post-run prediction using real benchmark data
      try {
        const postPred = await window.compressAPI.mlPredictFromBenchmark(inputPath, res.rows || []);
        setMlPostRun(postPred);
      } catch (e) {
        console.warn('ML post-run prediction failed:', e.message);
      }
      
      // Load compression graph as data URL for display
      if (res.graphPath) {
        try {
          const dataUrl = await window.compressAPI.loadImageAsDataUrl(res.graphPath);
          setCompGraphDataUrl(dataUrl);
          console.log('Compression graph loaded as data URL');
        } catch (error) {
          console.error('Failed to load compression graph:', error);
        }
      }
      
      // After compression, show decompression option and find recent files
      setShowDecompress(true);
      const files = await window.compressAPI.findRecentFiles(outputDir);
      setRecentFiles(files);
      
      // Auto-select the most recent file
      if (files.length > 0) {
        setSelectedFile(files[0]);
      }
    } catch (e) {
      alert('Run failed: ' + e.message);
    } finally {
      setRunning(false);
    }
  };

  const runDecompress = async () => {
    if (!selectedFile) return;
    
    setDecompressing(true);
    setDecompressResult(null);
    
    try {
      // Create output path in view_decomp directory
      const decompDir = outputDir + '\\view_decomp';
      const baseName = selectedFile.name.replace(/\.(gz|bz2|xz|zst|lz4)$/, '');
      const outputPath = `${decompDir}\\${baseName}_decompressed.txt`;
      
      const result = await window.compressAPI.runDecompress({
        compressedPath: selectedFile.path,
        outputPath: outputPath,
        tool: selectedFile.tool
      });
      
      setDecompressResult(result);
      
      if (result.success) {
        alert(`Decompression successful!\nOutput saved to: ${result.outputPath}`);
      } else {
        alert(`Decompression failed: ${result.message}`);
      }
    } catch (e) {
      alert('Decompression failed: ' + e.message);
      setDecompressResult({ success: false, message: e.message });
    } finally {
      setDecompressing(false);
    }
  };

  const runBatchDecompress = async () => {
    if (recentFiles.length === 0) return;
    
    setDecompressing(true);
    setDecompResults([]);
    setDecompGraphPath('');
    
    try {
      const result = await window.compressAPI.runBatchDecompress({
        files: recentFiles,
        outputDir: outputDir,
        originalPath: inputPath
      });
      
      setDecompResults(result.results || []);
      setDecompGraphPath(result.graphPath || '');
      
      // Load decompression graph as data URL for display
      if (result.graphPath) {
        try {
          const dataUrl = await window.compressAPI.loadImageAsDataUrl(result.graphPath);
          setDecompGraphDataUrl(dataUrl);
          console.log('Decompression graph loaded as data URL');
        } catch (error) {
          console.error('Failed to load decompression graph:', error);
        }
      }
      
      const successCount = (result.results || []).filter(r => r.success && r.verified).length;
      alert(`Batch decompression complete!\n${successCount} of ${recentFiles.length} files decompressed and verified successfully.`);
    } catch (e) {
      alert('Batch decompression failed: ' + e.message);
    } finally {
      setDecompressing(false);
    }
  };

  return (
    <div className="min-h-screen" style={{fontFamily:'Inter, system-ui, sans-serif', background:'#0b0d10', color:'#e2e8f0'}}>
      <div style={{maxWidth:980, margin:'0 auto', padding:'24px'}}>
        <h1 style={{fontSize:34, fontWeight:800, marginBottom:12}}>CompressAction</h1>
        <p style={{opacity:0.85, marginBottom:24}}>
          Imager-style launcher for lossless compression benchmarks on large assets/datasets,
          aligned with your senior research (ratio, time, memory/logs; container/K8s-ready stubs).
        </p>

        {/* Card 1: Pick file + destination (like choosing OS image + SD card) */}
        <div style={{background:'#12161c', borderRadius:16, padding:16, marginBottom:16, boxShadow:'0 10px 30px rgba(0,0,0,0.35)'}}>
          <h2 style={{fontSize:18, fontWeight:700, marginBottom:8}}>1) Choose File & Output</h2>
          <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:12, alignItems:'center'}}>
            <div>
              <div style={{fontSize:13, opacity:0.8, marginBottom:6}}>Input file (drag & drop or browse)</div>
              <div
                onDragOver={e=>{ 
                  e.preventDefault(); 
                  setDragOverInput(true);
                }}
                onDragLeave={e=>{ 
                  e.preventDefault(); 
                  setDragOverInput(false);
                }}
                onDrop={async e=>{
                  e.preventDefault();
                  setDragOverInput(false);
                  const files = Array.from(e.dataTransfer?.files || []);
                  if (files.length > 0) {
                    const file = files[0];
                    if (file.path) {
                      setInputPath(file.path);
                      setMlPrediction(null);
                      setMlPostRun(null);
                      setMlLoading(true);
                      try {
                        const pred = await window.compressAPI.mlPredict(file.path);
                        setMlPrediction(pred);
                      } catch (e) {
                        console.warn('ML pre-run prediction failed:', e.message);
                      } finally {
                        setMlLoading(false);
                      }
                    }
                  }
                }}
                style={{
                  background: dragOverInput ? '#1a2534' : '#0f1318', 
                  borderRadius:10, 
                  padding:'10px 12px', 
                  border: dragOverInput ? '2px dashed #4f8cff' : '1px solid #1e2633',
                  transition: 'all 0.2s ease',
                  minHeight: '44px',
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer'
                }}
              >{inputPath || '— Drag file here or click Browse —'}</div>
            </div>
            <button onClick={pickInput} style={btn()}>Browse</button>
          </div>

          <div style={{height:10}}/>
          <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:12, alignItems:'center'}}>
            <div>
              <div style={{fontSize:13, opacity:0.8, marginBottom:6}}>Output directory (drag & drop folder or choose)</div>
              <div
                onDragOver={e=>{ 
                  e.preventDefault(); 
                  setDragOverOutput(true);
                }}
                onDragLeave={e=>{ 
                  e.preventDefault(); 
                  setDragOverOutput(false);
                }}
                onDrop={async e=>{
                  e.preventDefault();
                  setDragOverOutput(false);
                  const files = Array.from(e.dataTransfer?.files || []);
                  if (files.length > 0) {
                    const file = files[0];
                    // For directories, check if path exists and use it
                    if (file.path) {
                      // If it's a file, get its directory
                      const path = file.path;
                      // Use the directory of the file if it's a file, otherwise use the path
                      const dirPath = path.includes('.') ? path.substring(0, path.lastIndexOf('\\')) : path;
                      setOutputDir(dirPath || path);
                    }
                  }
                }}
                style={{
                  background: dragOverOutput ? '#1a2534' : '#0f1318', 
                  borderRadius:10, 
                  padding:'10px 12px', 
                  border: dragOverOutput ? '2px dashed #4f8cff' : '1px solid #1e2633',
                  transition: 'all 0.2s ease',
                  minHeight: '44px',
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer'
                }}
              >{outputDir || '— Drag folder here or click Choose —'}</div>
            </div>
            <button onClick={pickOut} style={btn()}>Choose</button>
          </div>
        </div>

        {/* ML Recommendation Card — appears after file is selected */}
        {(mlLoading || mlPrediction) && (
          <div style={{background:'#12161c', borderRadius:16, padding:16, marginBottom:16, boxShadow:'0 10px 30px rgba(0,0,0,0.35)', border: '1px solid #1e2633'}}>
            <h2 style={{fontSize:18, fontWeight:700, marginBottom:8}}>ML Recommendation</h2>
            {mlLoading ? (
              <div style={{display:'flex', alignItems:'center', gap:10, opacity:0.7}}>
                <span style={{fontSize:13}}>Analysing file with Random Forest model…</span>
              </div>
            ) : mlPrediction?.error ? (
              <div style={{fontSize:13, color:'#ffd93d'}}>
                <span style={{fontWeight:600}}>Model unavailable:</span> {mlPrediction.error}
                <div style={{marginTop:6, opacity:0.7}}>Run all algorithms and compare by usability score.</div>
              </div>
            ) : mlPrediction && (
              <MlRecommendationPanel prediction={mlPrediction} label="Pre-run estimate" />
            )}
          </div>
        )}

        {/* Card 2: Algorithms (like imager "settings") */}
        <div style={{background:'#12161c', borderRadius:16, padding:16, marginBottom:16, boxShadow:'0 10px 30px rgba(0,0,0,0.35)'}}>
          <h2 style={{fontSize:18, fontWeight:700, marginBottom:8}}>2) Select Compression Tools</h2>
          <p style={{fontSize:13, opacity:0.8, marginBottom:12}}>Each tool will use optimal settings for best space efficiency. Decompression verification ensures data integrity.</p>
          <div style={{display:'flex', gap:18, flexWrap:'wrap'}}>
            {['zstd','xz','bzip2','gzip','lz4'].map(t => (
              <label key={t} style={chip(tools.includes(t))}>
                <input type="checkbox" checked={tools.includes(t)} onChange={()=>toggleTool(t)} />
                <span style={{marginLeft:8, textTransform:'uppercase', letterSpacing:0.5}}>{t}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Card 3: Run + Results (like imager progress & verify) */}
        <div style={{background:'#12161c', borderRadius:16, padding:16, marginBottom:16, boxShadow:'0 10px 30px rgba(0,0,0,0.35)'}}>
          <h2 style={{fontSize:18, fontWeight:700, marginBottom:12}}>3) Run</h2>
          <button onClick={run} disabled={running || !inputPath || !outputDir} style={btnPrimary(running)}>
            {running ? 'Running…' : 'Start Compression'}
          </button>
          <div style={{height:14}}/>
          {!!rows.length && (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:14}}>
                <thead>
                  <tr style={{textAlign:'left', borderBottom:'1px solid #1e2633'}}>
                    <th style={{padding:'8px 4px'}}>Tool</th>
                    <th style={{padding:'8px 4px'}}>Original Size</th>
                    <th style={{padding:'8px 4px'}}>Compressed Size</th>
                    <th style={{padding:'8px 4px'}}>Space Saved</th>
                    <th style={{padding:'8px 4px'}}>Compression Time</th>
                    <th style={{padding:'8px 4px'}}>Decompression</th>
                    <th style={{padding:'8px 4px'}}>Status</th>
                  </tr>
                </thead>
                <tbody>
                {rows.map((r,i)=>(
                  <tr key={i} style={{borderBottom:'1px solid #1e2633'}}>
                    <td style={{padding:'8px 4px', fontWeight:600}}>{r.tool.toUpperCase()}</td>
                    <td style={{padding:'8px 4px'}}>{prettyBytes(r.srcSize || 0)}</td>
                    <td style={{padding:'8px 4px', color:'#4ecdc4'}}>{prettyBytes(r.dstSize || 0)}</td>
                    <td style={{padding:'8px 4px', color:'#51cf66', fontWeight:600}}>{(r.ratio!=null) ? (r.ratio*100).toFixed(2)+'%' : '0.00%'}</td>
                    <td style={{padding:'8px 4px'}}>{r.compressTime ? r.compressTime.toFixed(2) + ' ms' : '0 ms'}</td>
                    <td style={{padding:'8px 4px'}}>
                      {r.decompressVerified ? (
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: '#51cf66',
                          color: '#0b0d10'
                        }}>
                          VERIFIED ({r.decompressTime ? r.decompressTime.toFixed(2) + 'ms' : ''})
                        </span>
                      ) : (
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: '#ff6b6b',
                          color: '#0b0d10'
                        }}>
                          FAILED
                        </span>
                      )}
                    </td>
                    <td style={{padding:'8px 4px'}}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 600,
                        background: r.error ? '#ff6b6b' : (r.skipped ? '#ffd93d' : '#51cf66'),
                        color: '#0b0d10'
                      }}>
                        {r.error ? 'ERROR' : (r.skipped ? 'SKIPPED' : 'USABLE')}
                      </span>
                    </td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
          )}
          {csvPath && (
            <div style={{marginTop:10, fontSize:13, opacity:0.8}}>
              <div>Results saved to: <code style={{background:'#1e2633', padding:'2px 6px', borderRadius:4}}>{csvPath}</code></div>
            </div>
          )}
          {compGraphDataUrl && (
            <div style={{marginTop:20}}>
              <h3 style={{fontSize:16, fontWeight:700, marginBottom:12}}>Compression Analysis</h3>
              <div style={{background:'#0f1318', borderRadius:10, padding:16, border:'1px solid #1e2633'}}>
                <img 
                  src={compGraphDataUrl} 
                  alt="Compression Graphs" 
                  style={{width:'100%', height:'auto', borderRadius:8}}
                  onLoad={() => console.log('Compression graph displayed successfully')}
                  onError={(e) => {
                    console.error('Failed to display compression graph');
                    e.target.parentElement.innerHTML = `<div style="color:#ff6b6b;padding:20px;text-align:center;">Failed to display graph</div>`;
                  }}
                />
              </div>
              <div style={{marginTop:8, fontSize:12, opacity:0.7, textAlign:'center'}}>
                Visual analysis shows compression efficiency, speed, and file size comparisons
              </div>
            </div>
          )}
        </div>

        {/* ML Post-Run Recommendation — appears after benchmark completes */}
        {mlPostRun && !mlPostRun.error && (
          <div style={{background:'#12161c', borderRadius:16, padding:16, marginBottom:16, boxShadow:'0 10px 30px rgba(0,0,0,0.35)', border:'1px solid #2a3a2a'}}>
            <h2 style={{fontSize:18, fontWeight:700, marginBottom:8}}>ML Recommendation (post-run)</h2>
            <p style={{fontSize:13, opacity:0.7, marginBottom:12}}>
              Trained on your actual benchmark results — more accurate than the pre-run estimate.
            </p>
            <MlRecommendationPanel prediction={mlPostRun} label="Based on real benchmark data" />
          </div>
        )}

        {/* Card 4: Decompression (appears after compression) */}
        {showDecompress && (
          <div style={{background:'#12161c', borderRadius:16, padding:16, marginBottom:16, boxShadow:'0 10px 30px rgba(0,0,0,0.35)'}}>
            <h2 style={{fontSize:18, fontWeight:700, marginBottom:12}}>4) Decompress Recent Files</h2>
            <p style={{fontSize:13, opacity:0.8, marginBottom:12}}>
              Select a compressed file to decompress. The app automatically detects the algorithm based on the file extension.
            </p>
            
            {recentFiles.length > 0 ? (
              <div>
                <div style={{fontSize:13, opacity:0.8, marginBottom:8}}>Recent compressed files:</div>
                <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:16}}>
                  {recentFiles.map((file, idx) => (
                    <label key={idx} style={{
                      display:'flex', 
                      alignItems:'center', 
                      gap:12,
                      background: selectedFile?.path === file.path ? '#24324a' : '#0f1318',
                      padding:'12px 16px',
                      borderRadius:10,
                      border: selectedFile?.path === file.path ? '2px solid #4f8cff' : '1px solid #1e2633',
                      cursor:'pointer',
                      transition:'all 0.2s ease'
                    }}>
                      <input 
                        type="radio" 
                        name="decompressFile" 
                        checked={selectedFile?.path === file.path}
                        onChange={() => setSelectedFile(file)}
                        style={{cursor:'pointer'}}
                      />
                      <div style={{flex:1}}>
                        <div style={{fontWeight:600, marginBottom:4}}>{file.name}</div>
                        <div style={{fontSize:12, opacity:0.7}}>
                          Algorithm: <span style={{textTransform:'uppercase', color:'#4ecdc4'}}>{file.tool}</span>
                          {' • '}
                          Modified: {new Date(file.mtime).toLocaleString()}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
                
                <div style={{display:'flex', gap:12}}>
                  <button 
                    onClick={runDecompress} 
                    disabled={decompressing || !selectedFile} 
                    style={{...btnPrimary(decompressing || !selectedFile), flex: 1}}
                  >
                    {decompressing ? 'Decompressing…' : 'Decompress Selected File'}
                  </button>
                  
                  <button 
                    onClick={runBatchDecompress} 
                    disabled={decompressing || recentFiles.length === 0} 
                    style={{...btn(), background: '#51cf66', color: '#0b0d10', fontWeight: 700, flex: 1}}
                  >
                    {decompressing ? 'Testing All…' : 'Test All Files (with Graphs)'}
                  </button>
                </div>
                
                {decompressResult && (
                  <div style={{
                    marginTop:16, 
                    padding:16, 
                    borderRadius:10,
                    background: decompressResult.success ? '#1a3a2a' : '#3a1a1a',
                    border: decompressResult.success ? '1px solid #51cf66' : '1px solid #ff6b6b'
                  }}>
                    <div style={{fontSize:14, fontWeight:600, marginBottom:8, color: decompressResult.success ? '#51cf66' : '#ff6b6b'}}>
                      {decompressResult.success ? '✓ Decompression Successful' : '✗ Decompression Failed'}
                    </div>
                    {decompressResult.success && (
                      <div style={{fontSize:13, opacity:0.9}}>
                        <div><strong>Output:</strong> {decompressResult.outputPath}</div>
                        <div><strong>Original Size:</strong> {prettyBytes(decompressResult.compressedSize)}</div>
                        <div><strong>Decompressed Size:</strong> {prettyBytes(decompressResult.decompressedSize)}</div>
                        <div><strong>Time:</strong> {decompressResult.decompressTime.toFixed(2)} ms</div>
                      </div>
                    )}
                    {!decompressResult.success && (
                      <div style={{fontSize:13, opacity:0.9}}>
                        <div><strong>Error:</strong> {decompressResult.message}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Batch Decompression Results */}
                {decompResults.length > 0 && (
                  <div style={{marginTop:16}}>
                    <h3 style={{fontSize:16, fontWeight:700, marginBottom:12}}>Decompression Test Results</h3>
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%', borderCollapse:'collapse', fontSize:14}}>
                        <thead>
                          <tr style={{textAlign:'left', borderBottom:'1px solid #1e2633'}}>
                            <th style={{padding:'8px 4px'}}>Tool</th>
                            <th style={{padding:'8px 4px'}}>Compressed</th>
                            <th style={{padding:'8px 4px'}}>Decompressed</th>
                            <th style={{padding:'8px 4px'}}>Time (ms)</th>
                            <th style={{padding:'8px 4px'}}>Verified</th>
                            <th style={{padding:'8px 4px'}}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                        {decompResults.map((r,i)=>(
                          <tr key={i} style={{borderBottom:'1px solid #1e2633'}}>
                            <td style={{padding:'8px 4px', fontWeight:600}}>{r.tool.toUpperCase()}</td>
                            <td style={{padding:'8px 4px'}}>{prettyBytes(r.compressedSize || 0)}</td>
                            <td style={{padding:'8px 4px', color:'#4ecdc4'}}>{prettyBytes(r.decompressedSize || 0)}</td>
                            <td style={{padding:'8px 4px'}}>{r.decompressTime ? r.decompressTime.toFixed(2) : '0.00'}</td>
                            <td style={{padding:'8px 4px'}}>
                              {r.verified ? (
                                <span style={{
                                  padding: '4px 8px',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  background: '#51cf66',
                                  color: '#0b0d10'
                                }}>
                                  ✓ YES
                                </span>
                              ) : (
                                <span style={{
                                  padding: '4px 8px',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  background: '#ff6b6b',
                                  color: '#0b0d10'
                                }}>
                                  ✗ NO
                                </span>
                              )}
                            </td>
                            <td style={{padding:'8px 4px'}}>
                              <span style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontWeight: 600,
                                background: r.success && r.verified ? '#51cf66' : '#ff6b6b',
                                color: '#0b0d10'
                              }}>
                                {r.success && r.verified ? 'USABLE' : 'FAILED'}
                              </span>
                            </td>
                          </tr>
                        ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Decompression Graphs */}
                {decompGraphDataUrl && (
                  <div style={{marginTop:20}}>
                    <h3 style={{fontSize:16, fontWeight:700, marginBottom:12}}>Decompression Analysis Visualization</h3>
                    <div style={{background:'#0f1318', borderRadius:10, padding:16, border:'1px solid #1e2633'}}>
                      <img 
                        src={decompGraphDataUrl} 
                        alt="Decompression Analysis Graphs" 
                        style={{width:'100%', height:'auto', borderRadius:8}}
                        onLoad={() => console.log('Decompression graph displayed successfully')}
                        onError={(e) => {
                          console.error('Failed to display decompression graph');
                          e.target.parentElement.innerHTML = `<div style="color:#ff6b6b;padding:20px;text-align:center;">Failed to display graph</div>`;
                        }}
                      />
                    </div>
                    <div style={{marginTop:8, fontSize:12, opacity:0.7, textAlign:'center'}}>
                      Visual analysis showing verification status, compression ratios, and file size comparisons
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{fontSize:13, opacity:0.7, padding:16, background:'#0f1318', borderRadius:10, border:'1px solid #1e2633'}}>
                No compressed files found in the output directory. Run compression first to generate files.
              </div>
            )}
          </div>
        )}

        {/* Footer: future hooks */}
        <div style={{fontSize:12, opacity:0.7}}>
          Future: File chunking and hashing to find best algorithms for different files
        </div>
      </div>
    </div>
  );
}

function btn() {
  return {
    background:'#1c2433', color:'#e2e8f0', padding:'10px 14px', borderRadius:10,
    border:'1px solid #2b3547', cursor:'pointer', fontWeight:600, fontSize: '14px'
  };
}
function btnPrimary(disabled) {
  return {
    background: disabled ? '#2b3547' : '#4f8cff',
    color: disabled ? '#6b7280' : '#0b0d10', 
    padding:'12px 16px', 
    borderRadius:12, 
    border:'none',
    cursor: disabled ? 'not-allowed' : 'pointer', 
    fontWeight:800,
    fontSize: '15px',
    transition: 'all 0.2s ease'
  };
}
function chip(on) {
  return {
    display:'inline-flex', alignItems:'center',
    background: on ? '#24324a' : '#18202d',
    border:'1px solid #2b3547', padding:'8px 12px', borderRadius:999,
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  };
}
