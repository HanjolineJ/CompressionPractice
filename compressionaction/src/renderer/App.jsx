import React, { useState } from 'react';

function prettyBytes(n) {
  if (!n && n !== 0) return '';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length-1) { v /= 1024; i++; }
  return `${v.toFixed(2)} ${units[i]}`;
}

export default function App() {
  const [inputPath, setInputPath] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [level, setLevel] = useState(6);
  const [tools, setTools] = useState(['zstd','xz','bzip2','gzip','lz4']);
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);
  const [csvPath, setCsvPath] = useState('');

  const toggleTool = (t) =>
    setTools(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev, t]);

  const pickInput = async () => {
    const p = await window.compressAPI.pickInputFile();
    if (p) setInputPath(p);
  };
  const pickOut = async () => {
    const p = await window.compressAPI.pickOutputDir();
    if (p) setOutputDir(p);
  };

  const run = async () => {
    if (!inputPath || !outputDir) return;
    setRunning(true); setRows([]); setCsvPath('');
    try {
      const res = await window.compressAPI.runJob({ inputPath, outputDir, tools, level });
      setRows(res.rows || []);
      setCsvPath(res.csvPath || '');
    } catch (e) {
      alert('Run failed: ' + e.message);
    } finally {
      setRunning(false);
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
              <div style={{fontSize:13, opacity:0.8, marginBottom:6}}>Input file</div>
              <div
                onDragOver={e=>{ e.preventDefault(); }}
                onDrop={async e=>{
                  e.preventDefault();
                  const f = e.dataTransfer?.files?.[0];
                  if (f) setInputPath(f.path || f.name);
                }}
                style={{background:'#0f1318', borderRadius:10, padding:'10px 12px', border:'1px solid #1e2633'}}
              >{inputPath || '— not selected —'}</div>
            </div>
            <button onClick={pickInput} style={btn()}>Browse</button>
          </div>

          <div style={{height:10}}/>
          <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:12, alignItems:'center'}}>
            <div>
              <div style={{fontSize:13, opacity:0.8, marginBottom:6}}>Output directory</div>
              <div style={{background:'#0f1318', borderRadius:10, padding:'10px 12px', border:'1px solid #1e2633'}}>{outputDir || '— not selected —'}</div>
            </div>
            <button onClick={pickOut} style={btn()}>Choose</button>
          </div>
        </div>

        {/* Card 2: Algorithms + Level (like imager “settings”) */}
        <div style={{background:'#12161c', borderRadius:16, padding:16, marginBottom:16, boxShadow:'0 10px 30px rgba(0,0,0,0.35)'}}>
          <h2 style={{fontSize:18, fontWeight:700, marginBottom:8}}>2) Configure</h2>
          <div style={{display:'flex', gap:18, flexWrap:'wrap'}}>
            {['zstd','xz','bzip2','gzip','lz4'].map(t => (
              <label key={t} style={chip(tools.includes(t))}>
                <input type="checkbox" checked={tools.includes(t)} onChange={()=>toggleTool(t)} />
                <span style={{marginLeft:8, textTransform:'uppercase', letterSpacing:0.5}}>{t}</span>
              </label>
            ))}
          </div>
          <div style={{height:14}}/>
          <div>
            <div style={{fontSize:13, opacity:0.8, marginBottom:6}}>Compression level ({level})</div>
            <input type="range" min="1" max="19" value={level} onChange={e=>setLevel(Number(e.target.value))} style={{width:'100%'}}/>
            <div style={{fontSize:12, opacity:0.7, marginTop:6}}>Tip: zstd ~3–7 for speed; xz higher for max ratio.</div>
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
                    <th>Tool</th><th>Level</th><th>Src</th><th>Dst</th><th>Saved</th><th>Time (ms)</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                {rows.map((r,i)=>(
                  <tr key={i} style={{borderBottom:'1px solid #1e2633'}}>
                    <td>{r.tool}</td>
                    <td>{r.level ?? ''}</td>
                    <td>{prettyBytes(r.srcSize || 0)}</td>
                    <td>{prettyBytes(r.dstSize || 0)}</td>
                    <td>{(r.ratio!=null) ? (r.ratio*100).toFixed(2)+'%' : ''}</td>
                    <td>{r.elapsedNs ? (r.elapsedNs/1e6).toFixed(2) : ''}</td>
                    <td>{r.error ? 'error' : (r.skipped ? 'skipped' : 'ok')}</td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
          )}
          {csvPath && <div style={{marginTop:10, fontSize:13, opacity:0.8}}>CSV saved to: <code>{csvPath}</code></div>}
        </div>

        {/* Footer: future hooks */}
        <div style={{fontSize:12, opacity:0.7}}>
          Future: content-defined chunking, zstd dictionaries, delta patches, OCI/eStargz, cosign — as planned. 
          (This launcher is the front door for your benchmarks & demos.) 
        </div>
      </div>
    </div>
  );
}

function btn() {
  return {
    background:'#1c2433', color:'#e2e8f0', padding:'10px 14px', borderRadius:10,
    border:'1px solid #2b3547', cursor:'pointer', fontWeight:600
  };
}
function btnPrimary(disabled) {
  return {
    background: disabled ? '#2b3547' : '#4f8cff',
    color:'#0b0d10', padding:'12px 16px', borderRadius:12, border:'none',
    cursor: disabled ? 'not-allowed' : 'pointer', fontWeight:800
  };
}
function chip(on) {
  return {
    display:'inline-flex', alignItems:'center',
    background: on ? '#24324a' : '#18202d',
    border:'1px solid #2b3547', padding:'8px 12px', borderRadius:999
  };
}
