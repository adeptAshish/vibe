import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useGame } from '../GameContext.jsx';

// Dynamic HSL palette (no flat static hex). Includes black & white.
const PALETTE = [
  'hsl(0 0% 100%)', 'hsl(0 0% 0%)',
  'hsl(0 80% 58%)', 'hsl(25 90% 55%)', 'hsl(45 95% 55%)', 'hsl(80 70% 50%)',
  'hsl(140 70% 48%)', 'hsl(170 75% 45%)', 'hsl(195 85% 52%)', 'hsl(220 85% 60%)',
  'hsl(260 80% 65%)', 'hsl(290 75% 62%)', 'hsl(320 80% 62%)', 'hsl(345 85% 60%)',
  'hsl(28 45% 40%)', 'hsl(0 0% 60%)',
];
const SIZES = [3, 8, 16, 28];

export default function DrawingCanvas({ canDraw }) {
  const { sendStroke, clearCanvas, undo, onDrawEvent } = useGame();
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const strokeId = useRef(null);

  const [color, setColor] = useState('hsl(260 80% 65%)');
  const [size, setSize] = useState(8);
  const [tool, setTool] = useState('brush');

  // Resize canvas to fill its wrapper (keeps a fixed internal resolution).
  const RES = { w: 1000, h: 700 };

  const getCtx = () => {
    if (!ctxRef.current && canvasRef.current) {
      ctxRef.current = canvasRef.current.getContext('2d', { willReadFrequently: true });
    }
    return ctxRef.current;
  };

  const drawSegment = useCallback((seg) => {
    const ctx = getCtx();
    if (!ctx) return;
    const { x0, y0, x1, y1, color: col, size: sz, tool: tl } = seg;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (tl === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = col;
    }
    ctx.lineWidth = sz;
    ctx.beginPath();
    ctx.moveTo(x0 * RES.w, y0 * RES.h);
    ctx.lineTo(x1 * RES.w, y1 * RES.h);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }, []);

  const floodFill = useCallback((nx, ny, cssColor) => {
    const ctx = getCtx();
    if (!ctx) return;
    const px = Math.floor(nx * RES.w);
    const py = Math.floor(ny * RES.h);
    const img = ctx.getImageData(0, 0, RES.w, RES.h);
    const data = img.data;
    const idx = (x, y) => (y * RES.w + x) * 4;
    // resolve target color via a temp pixel
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = 1;
    const tctx = tmp.getContext('2d');
    tctx.fillStyle = cssColor;
    tctx.fillRect(0, 0, 1, 1);
    const [fr, fg, fb] = tctx.getImageData(0, 0, 1, 1).data;

    const start = idx(px, py);
    const sr = data[start], sg = data[start + 1], sb = data[start + 2], sa = data[start + 3];
    if (sr === fr && sg === fg && sb === fb && sa === 255) return;
    const match = (i) => Math.abs(data[i] - sr) < 24 && Math.abs(data[i + 1] - sg) < 24 && Math.abs(data[i + 2] - sb) < 24 && Math.abs(data[i + 3] - sa) < 24;

    const stack = [[px, py]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= RES.w || y >= RES.h) continue;
      const i = idx(x, y);
      if (!match(i)) continue;
      data[i] = fr; data[i + 1] = fg; data[i + 2] = fb; data[i + 3] = 255;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    ctx.putImageData(img, 0, 0);
  }, []);

  const clearLocal = useCallback(() => {
    const ctx = getCtx();
    if (ctx) ctx.clearRect(0, 0, RES.w, RES.h);
  }, []);

  const replay = useCallback((strokes) => {
    clearLocal();
    for (const seg of strokes || []) {
      if (seg.tool === 'fill') floodFill(seg.x, seg.y, seg.color);
      else drawSegment(seg);
    }
  }, [clearLocal, drawSegment, floodFill]);

  // Subscribe to incoming draw events from other players / server.
  useEffect(() => {
    const off = onDrawEvent((type, payload) => {
      if (type === 'stroke') {
        if (payload.tool === 'fill') floodFill(payload.x, payload.y, payload.color);
        else drawSegment(payload);
      } else if (type === 'clear') clearLocal();
      else if (type === 'init' || type === 'replace') replay(payload);
    });
    return off;
  }, [onDrawEvent, drawSegment, floodFill, clearLocal, replay]);

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return { x: Math.min(1, Math.max(0, cx / rect.width)), y: Math.min(1, Math.max(0, cy / rect.height)) };
  };

  const down = (e) => {
    if (!canDraw) return;
    e.preventDefault();
    const p = pos(e);
    if (tool === 'fill') {
      floodFill(p.x, p.y, color);
      sendStroke({ strokeId: Math.random().toString(36).slice(2), tool: 'fill', color, x: p.x, y: p.y });
      return;
    }
    drawing.current = true;
    strokeId.current = Math.random().toString(36).slice(2);
    last.current = p;
    // dot on click
    const seg = { strokeId: strokeId.current, tool, color, size, x0: p.x, y0: p.y, x1: p.x + 0.0001, y1: p.y };
    drawSegment(seg);
    sendStroke(seg);
  };

  const move = (e) => {
    if (!canDraw || !drawing.current) return;
    e.preventDefault();
    const p = pos(e);
    const seg = { strokeId: strokeId.current, tool, color, size, x0: last.current.x, y0: last.current.y, x1: p.x, y1: p.y };
    drawSegment(seg);
    sendStroke(seg);
    last.current = p;
  };

  const up = () => {
    drawing.current = false;
    last.current = null;
  };

  const doClear = () => {
    clearLocal();
    clearCanvas();
  };

  return (
    <div className="canvas-area">
      <div className="canvas-wrap card tight" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          width={RES.w}
          height={RES.h}
          className="board"
          style={{ cursor: canDraw ? (tool === 'fill' ? 'cell' : 'crosshair') : 'default' }}
          onMouseDown={down}
          onMouseMove={move}
          onMouseUp={up}
          onMouseLeave={up}
          onTouchStart={down}
          onTouchMove={move}
          onTouchEnd={up}
        />
        {!canDraw && <div className="board-veil no-select">👀 Watch & guess in chat!</div>}
      </div>

      {canDraw && (
        <div className="toolbar card tight">
          <div className="row wrap" style={{ gap: 6 }}>
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => { setColor(c); setTool('brush'); }}
                className="no-select"
                style={{
                  width: 26, height: 26, borderRadius: 7, background: c,
                  border: color === c && tool !== 'eraser' ? '3px solid white' : '2px solid hsla(0 0% 100% / .2)',
                  transform: color === c ? 'scale(1.12)' : 'scale(1)', transition: 'transform .1s',
                }}
              />
            ))}
          </div>
          <div className="divider" />
          <div className="row wrap" style={{ gap: 8 }}>
            <button className={`chip sm ${tool === 'brush' ? 'active' : ''}`} onClick={() => setTool('brush')}>🖌️ Brush</button>
            <button className={`chip sm ${tool === 'fill' ? 'active' : ''}`} onClick={() => setTool('fill')}>🪣 Fill</button>
            <button className={`chip sm ${tool === 'eraser' ? 'active' : ''}`} onClick={() => setTool('eraser')}>🧽 Eraser</button>
            {SIZES.map((sz) => (
              <button key={sz} className={`chip sm ${size === sz ? 'active' : ''}`} onClick={() => setSize(sz)} style={{ width: 40, justifyContent: 'center' }}>
                <span style={{ width: sz / 1.6 + 4, height: sz / 1.6 + 4, borderRadius: 99, background: 'currentColor', display: 'block' }} />
              </button>
            ))}
            <button className="chip sm" onClick={undo}>↩️ Undo</button>
            <button className="chip sm" onClick={doClear}>🗑️ Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
