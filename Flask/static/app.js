(function(){
  const $ = (id) => document.getElementById(id);
  const fileInput = $("fileInput");
  const analyzeBtn = $("analyzeBtn");
  const statusEl = $("status");
  const preview = $("preview");
  const overlay = $("overlay");
  const results = $("results");
  const props = $("props");
  const toggleRace = $("toggleRace");
  const detectorSel = $("detector");

  $("year").textContent = new Date().getFullYear();

  function drawBoxes(faces) {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0,0,overlay.width,overlay.height);
    if (!preview.naturalWidth) return;
    const scaleX = overlay.clientWidth / preview.naturalWidth;
    const scaleY = overlay.clientHeight / preview.naturalHeight;
    ctx.lineWidth = 3; ctx.strokeStyle = '#667eea'; ctx.font = '14px Inter'; ctx.fillStyle = '#667eea';
    faces.forEach(f => {
      const {x,y,w,h} = f.box;
      ctx.strokeRect(x*scaleX, y*scaleY, w*scaleX, h*scaleY);
      ctx.fillText(`Face ${f.face_id}`, x*scaleX + 6, Math.max(14, y*scaleY - 6));
    });
  }

  function metric(label, value){
    return `<div class="metric"><strong>${label}</strong><span>${value}</span></div>`;
  }

  function progress(label, value){
    const v = Math.max(0, Math.min(100, Number(value)||0));
    return `<div><div style="display:flex;justify-content:space-between"><span>${label}</span><span>${v.toFixed(1)}%</span></div><div class="progress"><div style="width:${v}%"></div></div></div>`;
  }

  async function handleFileChange() {
    const file = fileInput.files && fileInput.files[0];
    if (!file) { analyzeBtn.disabled = true; return; }

    // Always enable once a file is chosen
    analyzeBtn.disabled = false;

    const url = URL.createObjectURL(file);
    preview.src = url;
    preview.style.display = 'block';

    try {
      if (preview.decode) { await preview.decode(); }
    } catch(e) {
      console.warn("preview.decode failed:", e);
    } finally {
      setTimeout(() => {
        overlay.width = preview.clientWidth || overlay.parentElement.clientWidth;
        overlay.height = preview.clientHeight || overlay.parentElement.clientHeight;
        const ctx = overlay.getContext('2d'); ctx.clearRect(0,0,overlay.width,overlay.height);
      }, 0);
      statusEl.textContent = '';
    }
  }

  fileInput.addEventListener('change', handleFileChange);
  fileInput.addEventListener('input', handleFileChange);

  analyzeBtn.addEventListener('click', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;

    analyzeBtn.disabled = true;
    statusEl.textContent = 'Analyzing… (TensorFlow + DeepFace)';

    const form = new FormData();
    form.append('image', file);
    form.append('include_race', toggleRace.checked ? 'true' : 'false');
    form.append('detector', detectorSel.value);

    try {
      const res = await fetch('/analyze', { method: 'POST', body: form });
      const data = await res.json();
      analyzeBtn.disabled = false;

      if (!res.ok) {
        statusEl.textContent = data.error || 'Error analyzing image.';
        results.innerHTML = '';
        return;
      }

      statusEl.textContent = `Detector: ${data.detector}`;

      // Image properties
      const p = data.properties || {};
      props.classList.remove('hidden');
      props.innerHTML = `
        <h2>Image Properties</h2>
        <div class="grid">
          ${metric('Dimensions', p.dimensions ?? '-')}
          ${metric('Color Mode', p.color_mode ?? '-')}
          ${metric('File Size', p.file_size_kb != null ? p.file_size_kb + ' KB' : '-')}
          ${metric('Brightness', p.brightness != null ? p.brightness + '%' : '-')}
          ${metric('Contrast', p.contrast != null ? p.contrast + '%' : '-')}
          ${metric('Resolution', p.resolution_mp != null ? p.resolution_mp + ' MP' : '-')}
          ${metric('Aspect Ratio', p.aspect_ratio != null ? p.aspect_ratio : '-')}
        </div>
      `;

      // Faces
      results.classList.remove('hidden');
      if (!data.faces || data.faces.length === 0) {
        results.innerHTML = `<h2>Face Analysis</h2><p>No faces detected. Try a clearer, front-facing photo.</p>`;
        drawBoxes([]);
        return;
      }

      drawBoxes(data.faces);

      let html = `<h2>Face Analysis</h2>`;
      data.faces.forEach(face => {
        html += `<div class="face">
          <div style="display:flex;align-items:center;gap:8px;justify-content:space-between">
            <div class="badge">Face #${face.face_id}</div>
            <div>Age: <strong>${face.age ?? '-'}</strong>, Gender: <strong>${face.gender ?? '-'}</strong></div>
          </div>
          <div class="row">
            <div>
              <h4>Emotions</h4>
              ${(Object.entries(face.emotions || {})).map(([k,v])=>progress(k, v)).join('')}
              <p><em>Dominant:</em> ${face.dominant_emotion ?? '-'}</p>
            </div>
            ${face.race ? `<div><h4>Race (model output)</h4>${Object.entries(face.race).map(([k,v])=>progress(k, v)).join('')}<p><em>Dominant:</em> ${face.dominant_race ?? '-'}</p></div>` : ''}
          </div>
        </div>`;
      });
      results.innerHTML = html;
    } catch (err) {
      analyzeBtn.disabled = false;
      statusEl.textContent = 'Network error while analyzing image.';
      console.error(err);
    }
  });

  // In case the browser pre-fills the file input (rare), ensure button state is correct
  if (fileInput.files && fileInput.files.length > 0) {
    analyzeBtn.disabled = false;
  }
})();
