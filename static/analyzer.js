// analyzer.js v2 - replaces the analysis logic of index.html
// Load at the end of <body>:  <script src="/analyzer.js?v=2"></script>
// Pass 1: find every fracture site. Pass 2: zoom into each site, verify it and tighten the box.
(function () {
  const L = {
    zh: { normal: '未发现明确骨折征象', unsure: '无法确定，建议人工复核', notxray: '这似乎不是骨骼X光影像，请上传X光片。',
      pFx: '骨折概率', cnt: n => '检出 ' + n + ' 处骨折', lang: '用中文',
      note: '结果仅供参考，无法排除细微骨折（如发丝骨折），请由医生复核。' },
    en: { normal: 'No clear fracture detected', unsure: 'Uncertain - manual review advised', notxray: 'This does not look like a skeletal X-ray. Please upload a radiograph.',
      pFx: 'Fracture probability', cnt: n => n + ' fracture site' + (n > 1 ? 's' : '') + ' detected', lang: 'in English',
      note: 'For reference only. Subtle fractures (e.g. hairline) cannot be excluded; please have a clinician review.' },
    ko: { normal: '명확한 골절 소견 없음', unsure: '판단 불가 - 전문가 재검토 권장', notxray: '골격 X선 영상이 아닌 것 같습니다. X선 사진을 업로드하세요.',
      pFx: '골절 확률', cnt: n => n + '곳 검출', lang: '한국어로',
      note: '참고용입니다. 미세 골절(예: 피로 골절)은 배제할 수 없으므로 전문가의 검토를 받으세요.' }
  };
  const S = k => (L[currentLang] || L.en)[k];
  const NAMES = FRACTURES.map(f => f.name.en);
  const HI = 0.6, LO = 0.35, MAXSITES = 4;

  const SYSTEM = 'You are a careful musculoskeletal radiology assistant inside an educational tool. ' +
    'Do NOT assume a fracture is present: many images are normal. Say fracture only when you can point to a cortical break, ' +
    'lucent fracture line, step-off, displacement, angulation or bone fragment. Normal variants (growth plates in children, ' +
    'nutrient canals, overlapping shadows, sesamoid bones, joint spaces) are NOT fractures. ' +
    'If the image is not a radiograph, set is_xray to false. Answer with one JSON object only, no other text.';

  const P1 = () => 'Analyze this radiograph and locate every fracture site.\nReturn exactly this JSON:\n' +
    '{"is_xray":true,"fracture_probability":0.00,"fractures":[{"type":"<name>","confidence":0.00,"box":{"x":0.0,"y":0.0,"w":0.0,"h":0.0}}],"findings":"..."}\n' +
    'Rules:\n- fracture_probability (0-1) = probability that at least one fracture is present. Below 0.2 means bone clearly intact.\n' +
    '- fractures = one entry per separate fracture site (two broken bones = 2 entries); [] if none; at most ' + MAXSITES + '.\n' +
    '- type = exactly one of: ' + NAMES.join(', ') + '.\n' +
    '- box = tight box around that fracture site, as fractions of the full image width/height; (x,y) = top-left corner.\n' +
    '- findings = 2-3 sentences describing what you see, ' + S('lang') + '. Mention limitations such as subtle findings or poor quality.';

  const P2 = type => 'This is a zoomed crop of a radiograph. A possible ' + type + ' was suspected near the centre. ' +
    'Decide carefully whether a real fracture is present in this crop (cortical break, lucent line, step-off, fragment); normal variants are not fractures.\n' +
    'Return exactly this JSON:\n{"fracture_present":true,"confidence":0.00,"type":"<name>","box":{"x":0.0,"y":0.0,"w":0.0,"h":0.0}}\n' +
    'type = exactly one of: ' + NAMES.join(', ') + '. box = tight box around the fracture site as fractions of THIS crop, (x,y) = top-left; null if no fracture.';

  const clamp = v => Math.max(0, Math.min(1, v));
  const okBox = b => b && [b.x, b.y, b.w, b.h].every(v => typeof v === 'number') && b.w > 0.01 && b.h > 0.01;
  const loadImg = f => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Image load failed')); i.src = URL.createObjectURL(f); });

  function enc(img, sx, sy, sw, sh, maxSide, cap) {
    const s = Math.min(maxSide / Math.max(sw, sh), cap);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * s)); c.height = Math.max(1, Math.round(sh * s));
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }

  function parseJson(text) {
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('No JSON in model reply');
    return JSON.parse(text.slice(a, b + 1));
  }

  async function ask(b64, text) {
    const res = await fetch('/.netlify/functions/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_tokens: 1200, system: SYSTEM, messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }, { type: 'text', text }] }] })
    });
    const body = await res.json();
    if (!res.ok) throw new Error((body.error && (body.error.message || body.error)) || ('HTTP ' + res.status));
    return parseJson(body.content.filter(b => b.type === 'text').map(b => b.text).join(''));
  }

  // Pass 2: zoom into one suspected site, verify it, and return a tighter box (full-image fractions)
  async function refine(img, f) {
    try {
      const W = img.naturalWidth, H = img.naturalHeight, b = f.box;
      const pw = Math.max(b.w * 1.7, 0.22), ph = Math.max(b.h * 1.7, 0.22);
      const x0 = clamp(b.x + b.w / 2 - pw / 2), y0 = clamp(b.y + b.h / 2 - ph / 2);
      const x1 = clamp(x0 + pw), y1 = clamp(y0 + ph);
      const cw = x1 - x0, ch = y1 - y0;
      const r = await ask(enc(img, x0 * W, y0 * H, cw * W, ch * H, 1024, 3), P2(f.type));
      if (!r.fracture_present) return null;
      const c2 = clamp(Number(r.confidence) || 0);
      const type = NAMES.includes(r.type) ? r.type : f.type;
      let box = b;
      if (okBox(r.box)) box = { x: clamp(x0 + r.box.x * cw), y: clamp(y0 + r.box.y * ch), w: Math.min(r.box.w * cw, 1), h: Math.min(r.box.h * ch, 1) };
      return { type, conf: (f.conf + c2) / 2, box };
    } catch (e) { console.warn('refine failed, keeping first-pass box', e); return f; }
  }

  function resetView() {
    document.getElementById('topName').style.color = '';
    document.getElementById('topBar').style.background = '';
    document.getElementById('descText').textContent = '';
  }

  function showSimple(title, line, color, desc) {
    resultsArea.style.display = 'block';
    document.getElementById('btnReset').style.display = 'block';
    const tn = document.getElementById('topName'); tn.textContent = title; tn.style.color = color;
    document.getElementById('topProb').textContent = line;
    const bar = document.getElementById('topBar'); bar.style.background = color; bar.style.width = '0';
    setTimeout(() => { bar.style.width = '100%'; }, 100);
    document.getElementById('probList').innerHTML = '';
    document.getElementById('detailSection').style.display = 'none';
    document.getElementById('descText').textContent = desc;
    document.getElementById('descArea').style.display = desc ? 'block' : 'none';
    bboxLegend.style.display = 'none'; previewHint.style.display = 'none';
    currentTopFractureName = null;
    if (originalImageData) ctx.putImageData(originalImageData, 0, 0);
  }

  generateBoxes = () => []; // never invent boxes

  async function analyzeV2() {
    if (!currentFile) return;
    btnAnalyze.disabled = true; btnAnalyze.classList.add('loading');
    btnText.textContent = t('btnAnalyze') + '...';
    hideError(); resultsArea.style.display = 'none'; bboxLegend.style.display = 'none';
    document.getElementById('detailSection').style.display = 'none';
    document.getElementById('descArea').style.display = 'none';
    scanOverlay.classList.add('active');
    if (originalImageData) ctx.putImageData(originalImageData, 0, 0);
    let img;
    try {
      img = await loadImg(currentFile);
      const r = await ask(enc(img, 0, 0, img.naturalWidth, img.naturalHeight, 1568, 1), P1());
      resetView();
      const desc = (r.findings || '') + '\n\n' + S('note');
      if (r.is_xray === false) { showSimple(S('notxray'), '', '#f59e0b', ''); return; }
      const p1 = clamp(Number(r.fracture_probability) || 0);
      if (p1 < LO) { showSimple(S('normal'), S('pFx') + ': ' + (p1 * 100).toFixed(1) + '%', '#4ade80', desc); return; }
      const sites = (Array.isArray(r.fractures) ? r.fractures : [])
        .filter(f => NAMES.includes(f.type) && okBox(f.box))
        .map(f => ({ type: f.type, conf: clamp(Number(f.confidence) || 0), box: f.box }))
        .filter(f => f.conf >= 0.3).sort((a, b) => b.conf - a.conf).slice(0, MAXSITES);
      const kept = (await Promise.all(sites.map(f => refine(img, f)))).filter(Boolean);
      const pf = kept.length ? Math.max(...kept.map(k => k.conf)) : 0;
      if (pf < HI) { showSimple(S('unsure'), S('pFx') + ': ' + (Math.max(pf, p1 * 0.5) * 100).toFixed(1) + '%', '#f59e0b', desc); return; }
      const preds = {};
      kept.forEach(k => { preds[k.type] = Math.max(preds[k.type] || 0, k.conf); });
      displayResults({ predictions: preds, clinical_description: desc,
        boxes: kept.map(k => ({ label: k.type, confidence: k.conf, x: k.box.x, y: k.box.y, w: k.box.w, h: k.box.h })) });
      document.getElementById('topProb').textContent = S('pFx') + ': ' + (pf * 100).toFixed(1) + '% · ' + S('cnt')(kept.length);
    } catch (e) {
      console.error(e); showError(t('errorAnalysis') + e.message);
    } finally {
      if (img) URL.revokeObjectURL(img.src);
      scanOverlay.classList.remove('active');
      btnAnalyze.disabled = false; btnAnalyze.classList.remove('loading');
      btnText.textContent = t('btnReAnalyze');
    }
  }

  btnAnalyze.removeEventListener('click', analyze);
  btnAnalyze.addEventListener('click', analyzeV2);
})();
