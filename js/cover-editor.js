/**
 * CoverEditor — Full-screen book cover editor for Genesis 2
 * Provides interactive text placement, styling, and image generation.
 */

export class CoverEditor {
  constructor(app) {
    this.app = app;
    this.textBlocks = [];
    this.selectedBlockId = null;
    this.dragging = false;
    this.resizing = false;         // true when dragging a corner handle
    this._resizeAnchor = null;     // opposite corner in canvas coords
    this._resizeStartDist = 0;     // initial distance from anchor to pointer
    this._resizeStartFontSize = 0; // initial fontSize at resize start
    this.dragStart = { x: 0, y: 0 };
    this.dragBlockStart = { x: 0, y: 0 };
    this.boundingBoxes = [];
    this.availableFonts = [];
    this.baseImage = null;      // data URL
    this.baseImageObj = null;    // loaded Image element
    this.refImageData = null;    // reference image data URL
    this.lockAspect = false;
    this.aspectRatio = 6 / 9;
    this._lastUnit = 'in';
    this._renderRequested = false;
    this._blockIdCounter = 0;
    this._isOpen = false;
    this._bgCanvas = null;       // cached background canvas
    this._bgDirty = true;
    this.canvas = null;
  }

  // ─── Initialization ──────────────────────────────────────

  init() {
    this.availableFonts = this._detectFonts();
    this._setupEventListeners();
  }

  _setupEventListeners() {
    const overlay = document.getElementById('cover-editor-overlay');
    if (!overlay) return;

    // Close button
    document.getElementById('btn-ce-close')?.addEventListener('click', () => this.close());
    // Save button
    document.getElementById('btn-ce-save')?.addEventListener('click', () => this.save());

    // Dimensions
    document.getElementById('btn-ce-apply-dims')?.addEventListener('click', () => this._applyDimensions());
    document.getElementById('ce-unit')?.addEventListener('change', (e) => this._onUnitChange(e.target.value));
    document.getElementById('ce-lock-aspect')?.addEventListener('change', (e) => {
      this.lockAspect = e.target.checked;
      if (this.lockAspect) {
        const w = parseFloat(document.getElementById('ce-width').value) || 6;
        const h = parseFloat(document.getElementById('ce-height').value) || 9;
        this.aspectRatio = w / h;
      }
    });
    document.getElementById('ce-width')?.addEventListener('input', () => this._onDimInput('width'));
    document.getElementById('ce-height')?.addEventListener('input', () => this._onDimInput('height'));

    // Generation
    document.getElementById('btn-ce-generate')?.addEventListener('click', () => this.generateImage());
    document.getElementById('btn-ce-auto-prompt')?.addEventListener('click', () => this.autoPrompt());
    document.getElementById('btn-ce-ref-upload')?.addEventListener('click', () => {
      document.getElementById('ce-ref-input')?.click();
    });
    document.getElementById('ce-ref-input')?.addEventListener('change', (e) => {
      if (e.target.files?.[0]) this._handleRefImageUpload(e.target.files[0]);
    });
    document.getElementById('btn-ce-ref-remove')?.addEventListener('click', () => this._removeRefImage());

    // Use reference as background
    document.getElementById('btn-ce-ref-use-bg')?.addEventListener('click', () => this._useRefAsBackground());

    // Add text block
    document.getElementById('btn-ce-add-block')?.addEventListener('click', () => {
      this.addTextBlock('Custom', '');
    });

    // Section toggles
    overlay.querySelectorAll('.ce-section-title').forEach(el => {
      el.addEventListener('click', () => {
        const body = el.nextElementSibling;
        if (body) {
          el.classList.toggle('collapsed');
          body.classList.toggle('collapsed');
        }
      });
    });

    // Text block controls — event delegation
    const blocksList = document.getElementById('ce-blocks-list');
    if (blocksList) {
      blocksList.addEventListener('input', (e) => {
        const el = e.target.closest('[data-block-id][data-prop]');
        if (!el) return;
        this._onBlockControlChange(el);
      });
      blocksList.addEventListener('change', (e) => {
        const el = e.target.closest('[data-block-id][data-prop]');
        if (!el) return;
        this._onBlockControlChange(el);
      });
      blocksList.addEventListener('click', (e) => {
        const actionEl = e.target.closest('[data-action]');
        if (actionEl) {
          const action = actionEl.dataset.action;
          const blockId = actionEl.dataset.blockId;
          if (action === 'remove') this.removeTextBlock(blockId);
          else if (action === 'move-up') this._moveBlock(blockId, -1);
          else if (action === 'move-down') this._moveBlock(blockId, 1);
          return;
        }
        const header = e.target.closest('.ce-block-header');
        if (header) {
          const blockId = header.dataset.blockId;
          const card = header.closest('.ce-block');
          if (card) card.classList.toggle('expanded');
          this._selectBlock(blockId);
        }
      });
    }

    // Canvas interaction
    this.canvas = document.getElementById('cover-edit-canvas');
    if (this.canvas) {
      this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
      this.canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
      this.canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
      this.canvas.addEventListener('pointerleave', (e) => this._onPointerUp(e));
    }
  }

  // ─── Open / Close ────────────────────────────────────────

  open() {
    const project = this.app._currentProject;
    if (!project) return;

    const overlay = document.getElementById('cover-editor-overlay');
    if (!overlay) return;
    overlay.classList.add('visible');
    this._isOpen = true;

    this.canvas = document.getElementById('cover-edit-canvas');
    this._bgCanvas = document.createElement('canvas');

    // Load from project
    this._loadFromProject(project);

    // Set up dimension controls
    this._populateDimensionControls();

    // Render text block cards
    this._renderAllBlockCards();

    // Load base image and render
    this._loadBaseImage(project.coverImageBase || project.coverImage || null);
  }

  close() {
    // Preserve text blocks in memory so reopening doesn't lose unsaved work
    const project = this.app._currentProject;
    if (project && this.textBlocks.length > 0) {
      project.coverTextBlocks = JSON.stringify(this.textBlocks);
    }
    const overlay = document.getElementById('cover-editor-overlay');
    if (overlay) overlay.classList.remove('visible');
    this._isOpen = false;
    this.selectedBlockId = null;
    this.dragging = false;
    this.resizing = false;
  }

  // ─── Dimension Management ────────────────────────────────

  _populateDimensionControls() {
    const project = this.app._currentProject;
    const saved = project?.coverEditorSettings;
    if (saved) {
      document.getElementById('ce-width').value = saved.width ?? 6;
      document.getElementById('ce-height').value = saved.height ?? 9;
      document.getElementById('ce-unit').value = saved.unit ?? 'in';
      document.getElementById('ce-dpi').value = saved.dpi ?? 300;
      document.getElementById('ce-lock-aspect').checked = !!saved.lockAspect;
      this.lockAspect = !!saved.lockAspect;
      this._lastUnit = saved.unit ?? 'in';
      if (saved.lockAspect && saved.width && saved.height) {
        this.aspectRatio = saved.width / saved.height;
      }
    } else {
      document.getElementById('ce-width').value = 6;
      document.getElementById('ce-height').value = 9;
      document.getElementById('ce-unit').value = 'in';
      document.getElementById('ce-dpi').value = 300;
      document.getElementById('ce-lock-aspect').checked = false;
      this._lastUnit = 'in';
    }
    // Load prompt
    document.getElementById('ce-prompt').value = project?.coverPrompt || '';
    this._applyDimensions();
  }

  _getPixelDimensions() {
    const w = parseFloat(document.getElementById('ce-width')?.value) || 6;
    const h = parseFloat(document.getElementById('ce-height')?.value) || 9;
    const unit = document.getElementById('ce-unit')?.value || 'in';
    const dpi = parseInt(document.getElementById('ce-dpi')?.value) || 300;

    switch (unit) {
      case 'in': return { w: Math.round(w * dpi), h: Math.round(h * dpi), dpi };
      case 'cm': return { w: Math.round((w / 2.54) * dpi), h: Math.round((h / 2.54) * dpi), dpi };
      case 'px': return { w: Math.round(w), h: Math.round(h), dpi };
    }
    return { w: 1800, h: 2700, dpi: 300 };
  }

  _applyDimensions() {
    const { w, h, dpi } = this._getPixelDimensions();
    if (!this.canvas) return;

    this.canvas.width = w;
    this.canvas.height = h;
    this._bgDirty = true;
    this._updateBackgroundCanvas();
    this.drawCanvas();
    this._updateDimensionInfo(w, h, dpi);
  }

  _updateDimensionInfo(w, h, dpi) {
    const info = document.getElementById('ce-canvas-info');
    if (!info) return;
    const unit = document.getElementById('ce-unit')?.value || 'in';
    const wDisp = document.getElementById('ce-width')?.value || '';
    const hDisp = document.getElementById('ce-height')?.value || '';
    const unitLabel = unit === 'in' ? 'in' : unit === 'cm' ? 'cm' : 'px';
    info.textContent = `${w} × ${h} px · ${dpi} DPI · ${wDisp} × ${hDisp} ${unitLabel}`;
  }

  _onUnitChange(newUnit) {
    const oldUnit = this._lastUnit;
    const dpi = parseInt(document.getElementById('ce-dpi')?.value) || 300;
    const w = parseFloat(document.getElementById('ce-width')?.value) || 6;
    const h = parseFloat(document.getElementById('ce-height')?.value) || 9;

    // Convert to pixels
    let pixW, pixH;
    switch (oldUnit) {
      case 'in': pixW = w * dpi; pixH = h * dpi; break;
      case 'cm': pixW = (w / 2.54) * dpi; pixH = (h / 2.54) * dpi; break;
      case 'px': pixW = w; pixH = h; break;
    }

    // Convert to new unit
    let newW, newH;
    switch (newUnit) {
      case 'in': newW = pixW / dpi; newH = pixH / dpi; break;
      case 'cm': newW = (pixW / dpi) * 2.54; newH = (pixH / dpi) * 2.54; break;
      case 'px': newW = pixW; newH = pixH; break;
    }

    const widthEl = document.getElementById('ce-width');
    const heightEl = document.getElementById('ce-height');
    if (widthEl) widthEl.value = newUnit === 'px' ? Math.round(newW) : parseFloat(newW.toFixed(2));
    if (heightEl) heightEl.value = newUnit === 'px' ? Math.round(newH) : parseFloat(newH.toFixed(2));

    this._lastUnit = newUnit;
  }

  _onDimInput(which) {
    if (!this.lockAspect) return;
    const widthEl = document.getElementById('ce-width');
    const heightEl = document.getElementById('ce-height');
    const unit = document.getElementById('ce-unit')?.value || 'in';

    if (which === 'width') {
      const w = parseFloat(widthEl.value) || 1;
      const h = w / this.aspectRatio;
      heightEl.value = unit === 'px' ? Math.round(h) : parseFloat(h.toFixed(2));
    } else {
      const h = parseFloat(heightEl.value) || 1;
      const w = h * this.aspectRatio;
      widthEl.value = unit === 'px' ? Math.round(w) : parseFloat(w.toFixed(2));
    }
  }

  // ─── Text Block Management ───────────────────────────────

  addTextBlock(label, text, defaults = {}) {
    const id = 'block_' + (++this._blockIdCounter);
    const dpi = parseInt(document.getElementById('ce-dpi')?.value) || 300;
    const block = {
      id,
      label: label || 'Text',
      text: text || '',
      fontFamily: defaults.fontFamily || (this.availableFonts[0] || 'Georgia'),
      fontSize: defaults.fontSize || 48,
      color: defaults.color || '#ffffff',
      x: defaults.x ?? 50,
      y: defaults.y ?? 50,
      textAlign: defaults.textAlign || 'center',
      angle: defaults.angle || 0,
      bold: defaults.bold ?? true,
      italic: defaults.italic ?? false,
      outlineSize: defaults.outlineSize ?? 0,
      outlineColor: defaults.outlineColor || '#000000',
      shadowEnabled: defaults.shadowEnabled ?? true,
      shadowBlur: defaults.shadowBlur ?? 4,
      shadowSize: defaults.shadowSize ?? 0,
      shadowSpread: defaults.shadowSpread ?? 0,
      shadowDistance: defaults.shadowDistance ?? 3,
      shadowColor: defaults.shadowColor || '#000000',
      shadowOpacity: defaults.shadowOpacity ?? 70,
      shadowAngle: defaults.shadowAngle ?? 135
    };
    this.textBlocks.push(block);
    this._renderAllBlockCards();
    this._selectBlock(id);
    this._requestRender();
    return block;
  }

  removeTextBlock(id) {
    this.textBlocks = this.textBlocks.filter(b => b.id !== id);
    if (this.selectedBlockId === id) this.selectedBlockId = null;
    this._renderAllBlockCards();
    this._requestRender();
  }

  _moveBlock(id, dir) {
    const idx = this.textBlocks.findIndex(b => b.id === id);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= this.textBlocks.length) return;
    const tmp = this.textBlocks[idx];
    this.textBlocks[idx] = this.textBlocks[newIdx];
    this.textBlocks[newIdx] = tmp;
    this._renderAllBlockCards();
    this._requestRender();
  }

  _selectBlock(blockId) {
    this.selectedBlockId = blockId;
    // Update UI selection state
    document.querySelectorAll('.ce-block').forEach(el => {
      el.classList.toggle('selected', el.dataset.blockId === blockId);
    });
    this._requestRender();
  }

  _onBlockControlChange(el) {
    const blockId = el.dataset.blockId;
    const prop = el.dataset.prop;
    const block = this.textBlocks.find(b => b.id === blockId);
    if (!block) return;

    if (el.type === 'checkbox') {
      block[prop] = el.checked;
    } else if (el.type === 'number' || el.type === 'range') {
      block[prop] = parseFloat(el.value) || 0;
      // Sync paired slider/number inputs
      const group = el.closest('.ce-slider-group');
      if (group) {
        const paired = group.querySelector(
          el.type === 'range' ? 'input[type="number"]' : 'input[type="range"]'
        );
        if (paired) paired.value = el.value;
      }
    } else {
      block[prop] = el.value;
    }
    this._requestRender();
  }

  // ─── Text Block UI Rendering ─────────────────────────────

  _renderAllBlockCards() {
    const container = document.getElementById('ce-blocks-list');
    if (!container) return;
    container.innerHTML = this.textBlocks.map(b => this._renderBlockCard(b)).join('');

    // Populate font selects
    container.querySelectorAll('select[data-prop="fontFamily"]').forEach(sel => {
      this._populateFontSelect(sel, sel.dataset.currentValue);
    });
  }

  _sliderInput(blockId, prop, value, min, max, step = 1, unit = '') {
    const unitHtml = unit ? `<span class="ce-unit-label">${unit}</span>` : '';
    return `<div class="ce-slider-group">
      <input type="range" class="ce-range ce-input" data-block-id="${blockId}" data-prop="${prop}" value="${value}" min="${min}" max="${max}" step="${step}">
      <input type="number" class="ce-num ce-input" data-block-id="${blockId}" data-prop="${prop}" value="${value}" min="${min}" max="${max}" step="${step}">
      ${unitHtml}
    </div>`;
  }

  _renderBlockCard(block) {
    const isSelected = block.id === this.selectedBlockId;
    const escapedText = this._escapeHtml(block.text);
    const escapedLabel = this._escapeHtml(block.label);
    const bid = block.id;

    return `
    <div class="ce-block ${isSelected ? 'selected expanded' : ''}" data-block-id="${bid}">
      <div class="ce-block-header" data-block-id="${bid}">
        <span class="ce-block-label">${escapedLabel}: ${escapedText || '(empty)'}</span>
        <div style="display:flex;gap:2px;">
          <button class="ce-block-btn" data-action="move-up" data-block-id="${bid}" title="Move up">&#9650;</button>
          <button class="ce-block-btn" data-action="move-down" data-block-id="${bid}" title="Move down">&#9660;</button>
          <button class="ce-block-btn ce-block-remove" data-action="remove" data-block-id="${bid}" title="Remove">&times;</button>
        </div>
      </div>
      <div class="ce-block-body">
        <!-- Text & Label -->
        <div class="form-group" style="margin-bottom:8px;">
          <label>Text</label>
          <input type="text" class="form-input ce-input" data-block-id="${bid}" data-prop="text" value="${escapedText}">
        </div>
        <div class="form-group" style="margin-bottom:8px;">
          <label>Label</label>
          <input type="text" class="form-input ce-input" data-block-id="${bid}" data-prop="label" value="${escapedLabel}" style="font-size:0.8rem;">
        </div>

        <!-- Font -->
        <div class="form-group" style="margin-bottom:8px;">
          <label>Font</label>
          <select class="form-input ce-input" data-block-id="${bid}" data-prop="fontFamily" data-current-value="${this._escapeHtml(block.fontFamily)}"></select>
        </div>

        <!-- Font Size -->
        <div class="form-group" style="margin-bottom:8px;">
          <label>Size</label>
          ${this._sliderInput(bid, 'fontSize', block.fontSize, 4, 400, 1, 'pt')}
        </div>

        <!-- Color & Alignment -->
        <div class="ce-row">
          <div class="form-group ce-half">
            <label>Color</label>
            <input type="color" class="ce-input ce-color-input" data-block-id="${bid}" data-prop="color" value="${block.color}">
          </div>
          <div class="form-group ce-half">
            <label>Align</label>
            <select class="form-input ce-input" data-block-id="${bid}" data-prop="textAlign">
              <option value="left" ${block.textAlign === 'left' ? 'selected' : ''}>Left</option>
              <option value="center" ${block.textAlign === 'center' ? 'selected' : ''}>Center</option>
              <option value="right" ${block.textAlign === 'right' ? 'selected' : ''}>Right</option>
            </select>
          </div>
        </div>

        <!-- Bold / Italic -->
        <div class="ce-row" style="margin-bottom:8px;">
          <label class="ce-check-label">
            <input type="checkbox" class="ce-input" data-block-id="${bid}" data-prop="bold" ${block.bold ? 'checked' : ''}> Bold
          </label>
          <label class="ce-check-label">
            <input type="checkbox" class="ce-input" data-block-id="${bid}" data-prop="italic" ${block.italic ? 'checked' : ''}> Italic
          </label>
        </div>

        <!-- Position -->
        <details class="ce-details" ${isSelected ? 'open' : ''}>
          <summary>Position</summary>
          <div class="form-group" style="margin-bottom:6px;">
            <label>X Position</label>
            ${this._sliderInput(bid, 'x', Math.round(block.x * 10) / 10, 0, 100, 0.5, '%')}
          </div>
          <div class="form-group" style="margin-bottom:6px;">
            <label>Y Position</label>
            ${this._sliderInput(bid, 'y', Math.round(block.y * 10) / 10, 0, 100, 0.5, '%')}
          </div>
          <div class="form-group">
            <label>Rotation</label>
            ${this._sliderInput(bid, 'angle', block.angle, -180, 180, 1, '\u00B0')}
          </div>
        </details>

        <!-- Outline -->
        <details class="ce-details">
          <summary>Outline</summary>
          <div class="form-group" style="margin-bottom:6px;">
            <label>Thickness</label>
            ${this._sliderInput(bid, 'outlineSize', block.outlineSize, 0, 30, 0.5, 'pt')}
          </div>
          <div class="form-group">
            <label>Color</label>
            <input type="color" class="ce-input ce-color-input" data-block-id="${bid}" data-prop="outlineColor" value="${block.outlineColor}">
          </div>
        </details>

        <!-- Shadow -->
        <details class="ce-details">
          <summary>Shadow</summary>
          <label class="ce-check-label" style="margin-bottom:8px;">
            <input type="checkbox" class="ce-input" data-block-id="${bid}" data-prop="shadowEnabled" ${block.shadowEnabled ? 'checked' : ''}> Enable Shadow
          </label>
          <div class="form-group" style="margin-bottom:6px;">
            <label>Distance</label>
            ${this._sliderInput(bid, 'shadowDistance', block.shadowDistance, 0, 50, 1)}
          </div>
          <div class="form-group" style="margin-bottom:6px;">
            <label>Size</label>
            ${this._sliderInput(bid, 'shadowSize', block.shadowSize || 0, 0, 30, 0.5)}
          </div>
          <div class="form-group" style="margin-bottom:6px;">
            <label>Blur</label>
            ${this._sliderInput(bid, 'shadowBlur', block.shadowBlur, 0, 50, 1)}
          </div>
          <div class="form-group" style="margin-bottom:6px;">
            <label>Spread (Gaussian)</label>
            ${this._sliderInput(bid, 'shadowSpread', block.shadowSpread || 0, 0, 40, 1)}
          </div>
          <div class="form-group" style="margin-bottom:6px;">
            <label>Opacity</label>
            ${this._sliderInput(bid, 'shadowOpacity', block.shadowOpacity, 0, 100, 1, '%')}
          </div>
          <div class="form-group" style="margin-bottom:6px;">
            <label>Angle</label>
            ${this._sliderInput(bid, 'shadowAngle', block.shadowAngle, 0, 360, 1, '\u00B0')}
          </div>
          <div class="form-group">
            <label>Color</label>
            <input type="color" class="ce-input ce-color-input" data-block-id="${bid}" data-prop="shadowColor" value="${block.shadowColor}">
          </div>
        </details>
      </div>
    </div>`;
  }

  _populateFontSelect(selectEl, currentValue) {
    const fonts = this.availableFonts;
    selectEl.innerHTML = fonts.map(f =>
      `<option value="${this._escapeHtml(f)}" ${f === currentValue ? 'selected' : ''}>${this._escapeHtml(f)}</option>`
    ).join('');
  }

  // ─── Canvas Rendering ────────────────────────────────────

  _updateBackgroundCanvas() {
    if (!this.canvas || !this._bgCanvas) return;
    this._bgCanvas.width = this.canvas.width;
    this._bgCanvas.height = this.canvas.height;
    const bgCtx = this._bgCanvas.getContext('2d');

    if (this.baseImageObj) {
      bgCtx.drawImage(this.baseImageObj, 0, 0, this._bgCanvas.width, this._bgCanvas.height);
    } else {
      // Checkerboard pattern for "no image"
      const size = 20;
      for (let y = 0; y < this._bgCanvas.height; y += size) {
        for (let x = 0; x < this._bgCanvas.width; x += size) {
          bgCtx.fillStyle = ((x / size + y / size) % 2 === 0) ? '#2a2a2a' : '#333333';
          bgCtx.fillRect(x, y, size, size);
        }
      }
    }
    this._bgDirty = false;
  }

  drawCanvas() {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext('2d');

    if (this._bgDirty) this._updateBackgroundCanvas();

    // Draw background
    ctx.drawImage(this._bgCanvas, 0, 0);

    // Reset bounding boxes
    this.boundingBoxes = [];

    // Draw each text block
    const dpi = parseInt(document.getElementById('ce-dpi')?.value) || 300;
    const scale = dpi / 72; // pt to canvas px

    for (const block of this.textBlocks) {
      this._drawTextBlock(ctx, block, scale, block.id === this.selectedBlockId);
    }
  }

  _drawTextBlock(ctx, block, scale, isSelected) {
    if (!block.text) {
      // Still record a small bounding box so it can be selected/moved
      const cx = (block.x / 100) * this.canvas.width;
      const cy = (block.y / 100) * this.canvas.height;
      this.boundingBoxes.push({ blockId: block.id, cx, cy, halfW: 20, halfH: 20, angle: block.angle });
      return;
    }

    const fontSizePx = block.fontSize * scale;
    const outlineSizePx = block.outlineSize * scale;

    // Build font string
    const weight = block.bold ? 'bold' : 'normal';
    const style = block.italic ? 'italic' : 'normal';
    const fontStr = `${style} ${weight} ${fontSizePx}px "${block.fontFamily}"`;

    ctx.save();

    // Position
    const cx = (block.x / 100) * this.canvas.width;
    const cy = (block.y / 100) * this.canvas.height;

    // Translate and rotate
    ctx.translate(cx, cy);
    if (block.angle !== 0) {
      ctx.rotate(block.angle * Math.PI / 180);
    }

    ctx.font = fontStr;
    ctx.textAlign = block.textAlign;
    ctx.textBaseline = 'middle';

    // Word wrap
    const maxWidth = this.canvas.width * 0.9;
    const lines = this._wrapText(ctx, block.text, maxWidth);
    const lineHeight = fontSizePx * 1.2;
    const totalHeight = lines.length * lineHeight;

    // Text anchor X
    let anchorX = 0;
    if (block.textAlign === 'left') anchorX = -maxWidth / 2;
    else if (block.textAlign === 'right') anchorX = maxWidth / 2;

    // Shadow rendering — uses ctx.shadowBlur/shadowOffset (works on all browsers incl. Safari)
    const hasShadow = block.shadowEnabled && (block.shadowDistance > 0 || block.shadowBlur > 0 || (block.shadowSpread || 0) > 0 || (block.shadowSize || 0) > 0);
    if (hasShadow) {
      const shadowDistPx = block.shadowDistance * scale;
      const shadowSizePx = (block.shadowSize || 0) * scale;
      const blurAmount = (block.shadowBlur + (block.shadowSpread || 0)) * scale;
      const angleRad = block.shadowAngle * Math.PI / 180;
      const offX = shadowDistPx * Math.sin(angleRad);
      const offY = -shadowDistPx * Math.cos(angleRad);
      const opacity = (block.shadowOpacity / 100).toFixed(2);
      const shadowRgba = this._hexToRgba(block.shadowColor, opacity);

      ctx.shadowOffsetX = offX;
      ctx.shadowOffsetY = offY;
      ctx.shadowBlur = blurAmount;
      ctx.shadowColor = shadowRgba;

      // Size expansion: stroke text to create a bigger shadow source
      if (shadowSizePx > 0) {
        ctx.lineWidth = shadowSizePx * 2;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = block.color;
        for (let i = 0; i < lines.length; i++) {
          const ly = -totalHeight / 2 + lineHeight * i + lineHeight / 2;
          ctx.strokeText(lines[i], anchorX, ly);
        }
      }

      // Fill text with shadow
      ctx.fillStyle = block.color;
      for (let i = 0; i < lines.length; i++) {
        const ly = -totalHeight / 2 + lineHeight * i + lineHeight / 2;
        ctx.fillText(lines[i], anchorX, ly);
      }

      // Reset shadow for subsequent draws
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    // Draw outline (no shadow)
    if (outlineSizePx > 0) {
      ctx.strokeStyle = block.outlineColor;
      ctx.lineWidth = outlineSizePx;
      ctx.lineJoin = 'round';
      for (let i = 0; i < lines.length; i++) {
        const ly = -totalHeight / 2 + lineHeight * i + lineHeight / 2;
        ctx.strokeText(lines[i], anchorX, ly);
      }
    }

    // Re-draw fill text on top (clean, covers shadow-pass stroke halo)
    ctx.fillStyle = block.color;
    for (let i = 0; i < lines.length; i++) {
      const ly = -totalHeight / 2 + lineHeight * i + lineHeight / 2;
      ctx.fillText(lines[i], anchorX, ly);
    }

    // Measure bounding box (needed for both selection indicator and hit testing)
    let maxLineW = 0;
    for (const line of lines) {
      maxLineW = Math.max(maxLineW, ctx.measureText(line).width);
    }
    const pad = 10 * scale;
    const halfW = maxLineW / 2 + pad;
    const halfH = totalHeight / 2 + pad;
    const hs = 7 * scale;

    // Selection indicator
    if (isSelected) {
      ctx.strokeStyle = '#4a9eff';
      ctx.lineWidth = 2 * scale;
      ctx.setLineDash([6 * scale, 4 * scale]);
      ctx.strokeRect(-halfW, -halfH, halfW * 2, halfH * 2);
      ctx.setLineDash([]);

      // Corner handles
      ctx.fillStyle = '#4a9eff';
      for (const [hx, hy] of [[-halfW, -halfH], [halfW, -halfH], [-halfW, halfH], [halfW, halfH]]) {
        ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2);
      }
    }

    ctx.restore();

    // Store bounding box with handle positions for hit testing
    const corners = [
      { lx: -halfW, ly: -halfH }, // top-left
      { lx:  halfW, ly: -halfH }, // top-right
      { lx: -halfW, ly:  halfH }, // bottom-left
      { lx:  halfW, ly:  halfH }  // bottom-right
    ];
    this.boundingBoxes.push({
      blockId: block.id,
      cx, cy,
      halfW, halfH,
      handleSize: hs,
      corners,
      angle: block.angle
    });
  }

  _wrapText(ctx, text, maxWidth) {
    if (!text) return [''];
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      const test = currentLine ? currentLine + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = test;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines.length > 0 ? lines : [''];
  }

  _requestRender() {
    if (!this._renderRequested && this._isOpen) {
      this._renderRequested = true;
      requestAnimationFrame(() => {
        this._renderRequested = false;
        this.drawCanvas();
      });
    }
  }

  // ─── Canvas Interaction ──────────────────────────────────

  _onPointerDown(e) {
    e.preventDefault();
    const coords = this._getCanvasCoords(e);

    // Check for corner handle hit on selected block first
    const handleHit = this._hitTestHandle(coords.x, coords.y);
    if (handleHit) {
      const block = this.textBlocks.find(b => b.id === handleHit.blockId);
      if (block) {
        this.resizing = true;
        this.dragging = false;
        this._resizeAnchor = handleHit.anchor;
        this._resizeStartDist = handleHit.dist;
        this._resizeStartFontSize = block.fontSize;
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
    }

    // Normal block hit test
    const hitId = this._hitTest(coords.x, coords.y);
    if (hitId) {
      this._selectBlock(hitId);
      this.dragging = true;
      this.resizing = false;
      const block = this.textBlocks.find(b => b.id === hitId);
      if (block) {
        this.dragStart = coords;
        this.dragBlockStart = {
          x: (block.x / 100) * this.canvas.width,
          y: (block.y / 100) * this.canvas.height
        };
      }
      this.canvas.setPointerCapture(e.pointerId);
    } else {
      this._selectBlock(null);
    }
    this._requestRender();
  }

  _onPointerMove(e) {
    if (!this.selectedBlockId) return;
    e.preventDefault();
    const coords = this._getCanvasCoords(e);
    const block = this.textBlocks.find(b => b.id === this.selectedBlockId);
    if (!block) return;

    if (this.resizing) {
      // Compute scale based on distance from anchor
      const dx = coords.x - this._resizeAnchor.x;
      const dy = coords.y - this._resizeAnchor.y;
      const currentDist = Math.sqrt(dx * dx + dy * dy);
      const scaleFactor = currentDist / this._resizeStartDist;

      // Apply scale to font size with bounds
      const newSize = Math.round(Math.max(4, Math.min(400, this._resizeStartFontSize * scaleFactor)));
      block.fontSize = newSize;
      // Update the sidebar font size slider+number without full re-render
      const container = document.getElementById('ce-blocks-list');
      if (container) {
        container.querySelectorAll(`[data-block-id="${block.id}"][data-prop="fontSize"]`).forEach(el => {
          el.value = newSize;
        });
      }
      this._requestRender();
      return;
    }

    if (this.dragging) {
      const dx = coords.x - this.dragStart.x;
      const dy = coords.y - this.dragStart.y;
      const newX = this.dragBlockStart.x + dx;
      const newY = this.dragBlockStart.y + dy;

      block.x = (newX / this.canvas.width) * 100;
      block.y = (newY / this.canvas.height) * 100;

      this._requestRender();
    }
  }

  _onPointerUp(e) {
    const wasResizing = this.resizing;
    if (this.dragging || this.resizing) {
      this.dragging = false;
      this.resizing = false;
      this.canvas?.releasePointerCapture(e.pointerId);
    }
    if (wasResizing) {
      this._renderAllBlockCards();
    }
  }

  _getCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  _hitTestHandle(canvasX, canvasY) {
    // Only check handles on the currently selected block
    if (!this.selectedBlockId) return null;
    const box = this.boundingBoxes.find(b => b.blockId === this.selectedBlockId);
    if (!box || !box.corners) return null;

    const { cx, cy, corners, handleSize, angle } = box;
    const rad = -(angle || 0) * Math.PI / 180;
    const dx = canvasX - cx;
    const dy = canvasY - cy;
    const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
    const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

    const hitRadius = handleSize * 2; // generous touch target
    for (let i = 0; i < corners.length; i++) {
      const c = corners[i];
      if (Math.abs(localX - c.lx) <= hitRadius && Math.abs(localY - c.ly) <= hitRadius) {
        // Anchor is the opposite corner, in canvas coords
        const opposite = corners[3 - i]; // 0↔3, 1↔2
        const cosA = Math.cos(-rad);
        const sinA = Math.sin(-rad);
        const anchorX = cx + opposite.lx * cosA - opposite.ly * sinA;
        const anchorY = cy + opposite.lx * sinA + opposite.ly * cosA;
        // Distance from anchor to the clicked point
        const adx = canvasX - anchorX;
        const ady = canvasY - anchorY;
        return {
          blockId: this.selectedBlockId,
          anchor: { x: anchorX, y: anchorY },
          dist: Math.sqrt(adx * adx + ady * ady) || 1
        };
      }
    }
    return null;
  }

  _hitTest(canvasX, canvasY) {
    // Check in reverse order (top-most rendered last)
    for (let i = this.boundingBoxes.length - 1; i >= 0; i--) {
      const { blockId, cx, cy, halfW, halfH, angle } = this.boundingBoxes[i];
      // Rotate point into local coords
      const rad = -(angle || 0) * Math.PI / 180;
      const dx = canvasX - cx;
      const dy = canvasY - cy;
      const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
      const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

      if (Math.abs(localX) <= halfW && Math.abs(localY) <= halfH) {
        return blockId;
      }
    }
    return null;
  }

  // ─── Font Detection ──────────────────────────────────────

  _detectFonts() {
    const testFonts = [
      'Georgia', 'Times New Roman', 'Garamond', 'Palatino', 'Palatino Linotype',
      'Book Antiqua', 'Baskerville', 'Didot', 'Cambria', 'Constantia',
      'Hoefler Text', 'Bodoni MT', 'Calisto MT', 'Rockwell',
      'Arial', 'Helvetica', 'Helvetica Neue', 'Verdana', 'Tahoma',
      'Trebuchet MS', 'Lucida Grande', 'Lucida Sans Unicode', 'Segoe UI',
      'Calibri', 'Candara', 'Franklin Gothic Medium', 'Futura',
      'Century Gothic', 'Gill Sans', 'Optima', 'Avenir', 'Avenir Next',
      'Roboto', 'Open Sans', 'Lato', 'Noto Sans', 'Source Sans Pro',
      'Courier New', 'Courier', 'Consolas', 'Monaco', 'Menlo',
      'Lucida Console', 'Liberation Mono', 'Liberation Sans', 'Liberation Serif',
      'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono',
      'Noto Serif', 'Noto Sans', 'Ubuntu', 'Ubuntu Mono',
      'Impact', 'Copperplate', 'Papyrus', 'Brush Script MT',
      'Comic Sans MS', 'American Typewriter', 'Marker Felt',
      'Bradley Hand', 'Snell Roundhand', 'Zapfino', 'Apple Chancery'
    ];

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const testStr = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ';
    const testSize = '72px';

    ctx.font = `${testSize} monospace`;
    const monoW = ctx.measureText(testStr).width;
    ctx.font = `${testSize} sans-serif`;
    const sansW = ctx.measureText(testStr).width;
    ctx.font = `${testSize} serif`;
    const serifW = ctx.measureText(testStr).width;

    const available = [];
    for (const font of testFonts) {
      let detected = false;
      for (const [fallback, baseW] of [['monospace', monoW], ['sans-serif', sansW], ['serif', serifW]]) {
        ctx.font = `${testSize} "${font}", ${fallback}`;
        if (ctx.measureText(testStr).width !== baseW) {
          detected = true;
          break;
        }
      }
      if (detected) available.push(font);
    }

    // Always include generic families
    if (!available.includes('serif')) available.push('serif');
    if (!available.includes('sans-serif')) available.push('sans-serif');
    if (!available.includes('monospace')) available.push('monospace');

    return available;
  }

  // ─── Image Loading ───────────────────────────────────────

  _loadBaseImage(dataUrl) {
    if (!dataUrl) {
      this.baseImage = null;
      this.baseImageObj = null;
      this._bgDirty = true;
      this._updateBackgroundCanvas();
      this.drawCanvas();
      return;
    }

    this.baseImage = dataUrl;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.baseImageObj = img;
      this._bgDirty = true;
      this._updateBackgroundCanvas();
      this.drawCanvas();
    };
    img.onerror = () => {
      console.warn('Failed to load cover base image');
      this.baseImageObj = null;
      this._bgDirty = true;
      this._updateBackgroundCanvas();
      this.drawCanvas();
    };
    img.src = dataUrl;
  }

  // ─── Reference Image ────────────────────────────────────

  _handleRefImageUpload(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      this.refImageData = e.target.result;
      const thumb = document.getElementById('ce-ref-thumb');
      const preview = document.getElementById('ce-ref-preview');
      if (thumb) thumb.src = this.refImageData;
      if (preview) preview.style.display = '';
    };
    reader.readAsDataURL(file);
  }

  _removeRefImage() {
    this.refImageData = null;
    const preview = document.getElementById('ce-ref-preview');
    if (preview) preview.style.display = 'none';
    const input = document.getElementById('ce-ref-input');
    if (input) input.value = '';
  }

  _useRefAsBackground() {
    if (!this.refImageData) return;
    this._loadBaseImage(this.refImageData);
  }

  // ─── Image Generation ────────────────────────────────────

  async autoPrompt() {
    const project = this.app._currentProject;
    if (!project) return;

    const statusEl = document.getElementById('ce-gen-status');
    if (statusEl) {
      statusEl.style.display = '';
      statusEl.textContent = 'Generating prompt from story...';
    }

    try {
      const chapters = await this.app.fs.getProjectChapters(project.id);
      let proseExcerpt = '';
      for (const ch of chapters) {
        if (ch.content) {
          const text = ch.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          proseExcerpt += text + ' ';
          if (proseExcerpt.length > 3000) break;
        }
      }
      const characters = await this.app.localStorage.getProjectCharacters(this.app.state.currentProjectId) || [];

      const prompt = await this.app.generator.generateCoverPrompt({
        title: project.title,
        genre: project.genre || '',
        proseExcerpt: proseExcerpt.trim(),
        characters
      });

      const promptEl = document.getElementById('ce-prompt');
      if (promptEl && prompt) promptEl.value = prompt;
      if (statusEl) statusEl.style.display = 'none';
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = 'Error: ' + err.message;
        setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
      }
    }
  }

  async generateImage() {
    const prompt = document.getElementById('ce-prompt')?.value?.trim();
    if (!prompt) {
      alert('Enter an image prompt first.');
      return;
    }

    const statusEl = document.getElementById('ce-gen-status');
    if (statusEl) {
      statusEl.style.display = '';
      statusEl.textContent = 'Generating cover image...';
    }

    try {
      let coverImage = null;

      // Try HuggingFace via Puter
      if (!coverImage && this.app._hfToken) {
        try {
          if (statusEl) statusEl.textContent = 'Generating via HuggingFace...';
          coverImage = await this.app.generator.generateCoverViaHF(prompt, this.app._hfToken);
        } catch (err) {
          console.warn('HF generation failed:', err.message);
        }
      }

      // Try Puter.js
      if (!coverImage) {
        try {
          if (statusEl) statusEl.textContent = 'Generating via Puter...';
          coverImage = await this.app.generator.generateCoverWithPuter(prompt);
        } catch (err) {
          console.warn('Puter generation failed:', err.message);
        }
      }

      if (!coverImage) {
        throw new Error('All image generation methods failed. Check your API keys in Settings.');
      }

      // Set as base image
      this.baseImage = coverImage;
      this._loadBaseImage(coverImage);

      if (statusEl) statusEl.style.display = 'none';
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = 'Error: ' + err.message;
        setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
      }
    }
  }

  // ─── Save / Load ─────────────────────────────────────────

  _compressDataUrl(dataUrl, maxBytes, startQuality = 0.8) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        let quality = startQuality;

        const attempt = () => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const cx = c.getContext('2d');
          cx.drawImage(img, 0, 0, w, h);
          let result = c.toDataURL('image/jpeg', quality);

          if (result.length <= maxBytes) return resolve(result);

          // Reduce quality first
          if (quality > 0.2) {
            quality -= 0.1;
            return attempt();
          }

          // Then downscale
          w = Math.round(w * 0.75);
          h = Math.round(h * 0.75);
          quality = 0.6;
          if (w < 100 || h < 100) return resolve(result); // give up
          attempt();
        };
        attempt();
      };
      img.onerror = () => resolve(dataUrl); // fallback
      img.src = dataUrl;
    });
  }

  async save() {
    const project = this.app._currentProject;
    if (!project) return;

    // Preserve text blocks in memory immediately (survives close + reopen)
    project.coverTextBlocks = JSON.stringify(this.textBlocks);

    // Redraw at final resolution
    this.drawCanvas();
    await new Promise(r => setTimeout(r, 100));

    try {
      // Firestore doc limit is 1,048,576 bytes. Reserve ~100KB for metadata + text fields.
      // Split the remaining ~950KB between coverImage and coverImageBase.
      const PER_IMAGE_MAX = 400000;

      // Compress the rendered canvas
      const coverImage = await this._compressDataUrl(
        this.canvas.toDataURL('image/jpeg', 0.85), PER_IMAGE_MAX
      );

      // Compress the base image (raw AI image) separately
      let coverImageBase = null;
      if (this.baseImage) {
        coverImageBase = await this._compressDataUrl(this.baseImage, PER_IMAGE_MAX, 0.7);
      }

      // Build save data
      const unit = document.getElementById('ce-unit')?.value || 'in';
      const updates = {
        coverImage,
        coverImageBase,
        coverPrompt: document.getElementById('ce-prompt')?.value || '',
        coverTextBlocks: project.coverTextBlocks,
        coverEditorSettings: {
          width: parseFloat(document.getElementById('ce-width')?.value) || 6,
          height: parseFloat(document.getElementById('ce-height')?.value) || 9,
          unit,
          dpi: parseInt(document.getElementById('ce-dpi')?.value) || 300,
          lockAspect: this.lockAspect
        }
      };

      await this.app.fs.updateProject(project.id, updates);
      Object.assign(project, updates);
      this.app._updateCoverDisplay();

      this.close();
    } catch (err) {
      alert('Failed to save cover: ' + err.message);
    }
  }

  _loadFromProject(project) {
    this.textBlocks = [];
    this._blockIdCounter = 0;

    // Try loading new format
    if (project.coverTextBlocks) {
      try {
        const blocks = JSON.parse(project.coverTextBlocks);
        if (Array.isArray(blocks) && blocks.length > 0) {
          this.textBlocks = blocks;
          // Update ID counter
          for (const b of blocks) {
            const num = parseInt(b.id?.replace('block_', ''), 10);
            if (num > this._blockIdCounter) this._blockIdCounter = num;
          }
          return;
        }
      } catch (e) {
        console.warn('Failed to parse coverTextBlocks:', e);
      }
    }

    // Backward compatibility: convert old format
    const title = project.coverTitle || project.title || '';
    const subtitle = project.coverSubtitle || project.subtitle || '';
    const author = project.coverAuthor || '';
    const font = project.coverFont || 'Georgia';
    const fontSize = project.coverFontSize || 48;
    const color = project.coverTextColor || '#ffffff';
    const pos = project.coverTextPosition || 'bottom';
    const shadow = project.coverTextShadow || 'light';

    // Convert position to y percentage
    let titleY = 80, subtitleY = 87, authorY = 94;
    if (pos === 'top') { titleY = 12; subtitleY = 19; authorY = 94; }
    else if (pos === 'center') { titleY = 45; subtitleY = 52; authorY = 94; }

    const shadowEnabled = shadow !== 'none';
    const shadowBlur = shadow === 'heavy' ? 8 : 4;
    const shadowDist = shadow === 'heavy' ? 3 : 2;

    this.addTextBlock('Title', title, {
      fontFamily: font, fontSize, color, x: 50, y: titleY,
      bold: true, shadowEnabled, shadowBlur, shadowDistance: shadowDist
    });
    this.addTextBlock('Subtitle', subtitle, {
      fontFamily: font, fontSize: Math.round(fontSize * 0.5), color, x: 50, y: subtitleY,
      bold: false, shadowEnabled, shadowBlur: shadowBlur * 0.7, shadowDistance: shadowDist
    });
    this.addTextBlock('Author', author, {
      fontFamily: font, fontSize: Math.round(fontSize * 0.4), color, x: 50, y: authorY,
      bold: false, shadowEnabled, shadowBlur: shadowBlur * 0.5, shadowDistance: shadowDist
    });
  }

  // ─── Utilities ───────────────────────────────────────────

  _escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
}
